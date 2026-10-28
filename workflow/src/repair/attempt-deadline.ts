/**
 * The deadline of one repair attempt, shared by all its tries: it starts with the attempt's first model job and bounds
 * every try's jobs, build and narrow check start, however long a try waited for its place in the model pool.
 */
export class AttemptDeadline {
  private startedAt: Date | null = null;

  constructor(readonly ms: number, private readonly now: () => Date) {}

  /** Starts the deadline with the first model job that gets its place; later calls change nothing. */
  start(): void {
    this.startedAt ??= this.now();
  }

  /** The time the deadline falls, in milliseconds since the epoch; before any job started, one deadline from now. */
  get at(): number {
    return (this.startedAt ?? this.now()).getTime() + this.ms;
  }

  minutesLeft(): number {
    return (this.at - this.now().getTime()) / 60_000;
  }

  get passed(): boolean {
    return this.minutesLeft() <= 0;
  }
}
