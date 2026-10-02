import { z } from "zod";
import { maximumFiles, repairableFolder } from "./patch-guard.js";
import { unsafePath } from "./repair-schemas.js";

export const planPromptVersion = "repair-plan-v1";
export const subtaskPromptVersion = "repair-task-v1";
export const maximumSubtasks = 5;

const SubtaskSchema = z.strictObject({
  /** The subtask's position, 1 to n. */
  id: z.number().int(),
  title: z.string(),
  /** What to change and why, for the job that implements it. */
  instructions: z.string(),
  /** The files the subtask may change, relative to the source, with `/` separators. */
  files: z.array(z.string()),
  /** The subtasks that must be done first; each lower than `id`. */
  blockedBy: z.array(z.number().int()),
});

/** A plan job's answer; types and enums only, the rest checked by `validatePlan`. */
export const PlanOutputSchema = z.strictObject({
  outcome: z.enum(["planned", "no_plan"]),
  reason: z.string(),
  summary: z.string(),
  tasks: z.array(SubtaskSchema),
});
export type PlanOutput = z.infer<typeof PlanOutputSchema>;
export type Subtask = z.infer<typeof SubtaskSchema>;

/** Every subtask that must be done before each subtask, directly or through others, by ID. */
export function blockerClosure(tasks: readonly Subtask[]): Map<number, Set<number>> {
  const closure = new Map<number, Set<number>>();
  for (const task of [...tasks].sort((left, right) => left.id - right.id)) {
    const all = new Set<number>();
    for (const blocker of task.blockedBy) {
      all.add(blocker);
      for (const earlier of closure.get(blocker) ?? []) all.add(earlier);
    }
    closure.set(task.id, all);
  }
  return closure;
}

/** The errors of a schema-valid plan; empty when it may be implemented. */
export function validatePlan(output: PlanOutput): string[] {
  const errors: string[] = [];
  if (output.reason.trim().length === 0) errors.push("reason is empty");
  if (output.summary.trim().length === 0) errors.push("summary is empty");
  if (output.outcome === "no_plan") {
    if (output.tasks.length > 0) errors.push("a no_plan answer lists subtasks");
    return errors;
  }
  if (output.tasks.length === 0 || output.tasks.length > maximumSubtasks) errors.push(`a plan has 1 to ${maximumSubtasks} subtasks, this one ${output.tasks.length}`);
  for (const [index, task] of output.tasks.entries()) {
    const at = `tasks[${index}]`;
    if (task.id !== index + 1) errors.push(`${at} has id ${task.id}, not ${index + 1}`);
    if (task.title.trim().length === 0) errors.push(`${at} title is empty`);
    if (task.instructions.trim().length === 0) errors.push(`${at} instructions are empty`);
    if (task.files.length === 0) errors.push(`${at} names no file`);
    for (const [fileIndex, path] of task.files.entries()) {
      const problem = unsafePath(path);
      if (problem !== null) errors.push(`${at}.files[${fileIndex}] '${path}' ${problem}`);
      else if (!path.startsWith(repairableFolder)) errors.push(`${at}.files[${fileIndex}] '${path}' is outside ${repairableFolder}`);
      if (task.files.indexOf(path) !== fileIndex) errors.push(`${at}.files[${fileIndex}] '${path}' is named twice`);
    }
    for (const blocker of task.blockedBy) {
      if (blocker < 1 || blocker >= task.id) errors.push(`${at} is blocked by ${blocker}, which is not a lower subtask`);
    }
    if (new Set(task.blockedBy).size !== task.blockedBy.length) errors.push(`${at} names a blocker twice`);
  }
  if (errors.length > 0) return errors;
  const files = new Set(output.tasks.flatMap((task) => task.files));
  if (files.size > maximumFiles) errors.push(`the plan names ${files.size} files, more than ${maximumFiles}`);
  const closure = blockerClosure(output.tasks);
  for (const later of output.tasks) {
    for (const earlier of output.tasks.filter((task) => task.id < later.id && !closure.get(later.id)!.has(task.id))) {
      for (const path of later.files.filter((file) => earlier.files.includes(file))) {
        errors.push(`subtasks ${earlier.id} and ${later.id} may run at the same time and both name ${path}`);
      }
    }
  }
  return errors;
}
