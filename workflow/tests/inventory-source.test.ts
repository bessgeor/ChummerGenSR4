import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compiledSourcePaths, processGit } from "../src/diagnosis/source-snapshot.js";
import { SetupError } from "../src/host/setup-error.js";
import { parseDesigner, type DesignerSource } from "../src/inventory/designer-parser.js";
import { buildSourceInventory, designerPaths } from "../src/inventory/source-inventory.js";
import { SourceInventorySchema } from "../src/inventory/source-inventory-document.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const designer = `namespace Chummer
{
    partial class frmSample
    {
        private void InitializeComponent()
        {
            this.panSkills = new System.Windows.Forms.Panel();
            this.cmsSkill = new System.Windows.Forms.ContextMenuStrip(this.components);
            this.panSkills.Controls.Add(this.cmdAdd);
            this.cmdAdd.Tag = "Button_AddSkill";
            this.cmdAdd.Text = "Add \\"Skill\\"";
            this.cmdAdd.ContextMenuStrip = this.cmsSkill;
            this.cmdAdd.Click += new System.EventHandler(this.cmdAdd_Click);
            this.cmsSkill.Items.AddRange(new System.Windows.Forms.ToolStripItem[] {
            this.tsNotes,
            this.tsDelete});
            this.tsNotes.Click += new System.EventHandler(this.tsNotes_Click);
            this.cboList.Items.AddRange(new object[] {
            "first",
            "second"});
            this.splitMain.Panel1.Controls.Add(this.panSkills);
            this.splitMain.Panel1.Resize += new System.EventHandler(this.splitMain_Panel1_Resize);
            this.Controls.Add(this.splitMain);
            this.Name = "frmSample";
            this.Load += new System.EventHandler(this.frmSample_Load);
        }

        private System.Windows.Forms.Panel panSkills;
        internal System.Windows.Forms.Button cmdAdd;
        private System.Windows.Forms.ContextMenuStrip cmsSkill;
        private System.Windows.Forms.ToolStripMenuItem tsNotes;
        private System.Windows.Forms.ToolStripMenuItem tsDelete;
        private System.Windows.Forms.ComboBox cboList;
        private System.Windows.Forms.SplitContainer splitMain;
    }
}
`;

const code = `namespace Chummer
{
    public partial class frmSample : Form
    {
        private void frmSample_Load(object sender, EventArgs e) { }

        private void cmdAdd_Click(object sender, EventArgs e) { }

        private void tsNotes_Click(object sender, EventArgs e) { }

        private void splitMain_Panel1_Resize(object sender, EventArgs e) { }
    }
}
`;

function source(designerText = designer, codeText: string | null = code): DesignerSource {
  return { designerPath: "Chummer/frmSample.Designer.cs", designerText, codePath: "Chummer/frmSample.cs", codeText };
}

function failsWith(text: string, codeText: string | null, pattern: RegExp): void {
  throws(() => parseDesigner(source(text, codeText)), (error: unknown) => error instanceof SetupError && pattern.test(error.message));
}

test("a designer file gives its controls, containment, strings and bindings with their handlers", () => {
  const parsed = parseDesigner(source());
  ok(parsed !== null);
  deepStrictEqual([parsed.name, parsed.namespace, parsed.baseType, parsed.instanceName], ["frmSample", "Chummer", "Form", "frmSample"]);
  const control = (name: string) => parsed.controls.find((item) => item.name === name);
  deepStrictEqual(control("cmdAdd"), {
    name: "cmdAdd", type: "System.Windows.Forms.Button", parent: "panSkills", line: 29, text: "Add \"Skill\"", tag: "Button_AddSkill", contextMenu: "cmsSkill",
  });
  deepStrictEqual(["panSkills", "tsNotes", "tsDelete", "cboList", "splitMain"].map((name) => control(name)?.parent), ["splitMain", "cmsSkill", "cmsSkill", null, "(self)"]);
  deepStrictEqual(parsed.interactions.map((item) => [item.id, item.target, item.member, item.event, item.handler, item.handlerLine, item.designerLine]), [
    ["frmSample.cmdAdd.Click", "cmdAdd", null, "Click", "cmdAdd_Click", 7, 13],
    ["frmSample.tsNotes.Click", "tsNotes", null, "Click", "tsNotes_Click", 9, 17],
    ["frmSample.splitMain.Panel1.Resize", "splitMain", "Panel1", "Resize", "splitMain_Panel1_Resize", 11, 22],
    ["frmSample.(self).Load", null, null, "Load", "frmSample_Load", 5, 25],
  ]);
  equal(parsed.interactions[0]?.handlerFile, "Chummer/frmSample.cs");
});

test("a designer file without InitializeComponent is not a class of the inventory", () => {
  equal(parseDesigner(source("namespace Chummer.Properties { internal class Resources { } }", null)), null);
});

test("every construct the parser cannot account for fails it with its file and line", () => {
  failsWith(designer.replace("this.cmdAdd.Click += new System.EventHandler(this.cmdAdd_Click);", "this.cmdAdd.Click += (s, e) => { };"),
    code, /frmSample\.Designer\.cs:13: cannot read this event binding/);
  failsWith(designer.replace("this.panSkills.Controls.Add(this.cmdAdd);", "this.panSkills.Controls.Add(this.cmdMissing);"),
    code, /:9: a containment names the undeclared field cmdMissing/);
  failsWith(designer.replace("this.tsNotes.Click", "this.tsGone.Click"), code, /:17: an event binding names the undeclared field tsGone/);
  failsWith(designer, code.replace("cmdAdd_Click", "cmdAddSkill_Click"), /:13: the handler cmdAdd_Click is not defined in Chummer\/frmSample\.cs/);
  failsWith(designer, null, /class frmSample has no code file Chummer\/frmSample\.cs/);
  failsWith(designer, code.replace("frmSample : Form", "frmSample"), /class frmSample declares no base type/);
  failsWith(designer.replace("this.tsNotes.Click += new System.EventHandler(this.tsNotes_Click);",
    "this.cmdAdd.Click += new System.EventHandler(this.tsNotes_Click);"), code, /the interaction frmSample\.cmdAdd\.Click is bound twice/);
  failsWith(designer.replace("this.Controls.Add(this.splitMain);", "this.Controls.Add(this.splitMain);\n            this.Controls.Add(this.panSkills);"),
    code, /panSkills is added to splitMain and to \(self\)/);
  failsWith(designer.replace("            this.tsDelete});", "            this.tsDelete, 7});"), code, /cannot read this line of cmsSkill's item list/);
  failsWith(designer.replace("this.Controls.Add(this.splitMain);", "this.Controls.AddRange(new System.Windows.Forms.Control[] { this.splitMain });"),
    code, /:23: cannot read this item list/);
});

test("a string's escapes read as C# reads them, and one that cannot be read fails the file", () => {
  const withText = (literal: string) => designer.replace('"Add \\"Skill\\""', literal);
  const parsed = parseDesigner(source(withText(String.raw`"Tab\tA\u00e9\x41\'\\"`)));
  equal(parsed?.controls.find((item) => item.name === "cmdAdd")?.text, "Tab\tA\u00e9A'\\");
  failsWith(withText(String.raw`"bad \q"`), code, /frmSample\.Designer\.cs:11: the string "bad \\q" has the escape \\q/);
  failsWith(withText(String.raw`"bad \U00110000"`), code, /:11: the string .* beyond U\+10FFFF/);
});

test("a string assignment may continue over lines, and one that is not a string literal fails the file", () => {
  const assign = (statement: string) => designer.replace(/this\.cmdAdd\.Text = .*;/, statement);
  const joined = parseDesigner(source(assign(`this.cmdAdd.Text = "Add " +
            "Skill" +
            "s";`)));
  equal(joined?.controls.find((item) => item.name === "cmdAdd")?.text, "Add Skills");
  deepStrictEqual(joined?.interactions.map((item) => item.designerLine).slice(0, 2), [15, 19]);
  failsWith(assign('this.cmdAdd.Text = resources.GetString("Add");'), code, /frmSample\.Designer\.cs:11: cannot read this string assignment: resources/);
  failsWith(assign('this.cmdAdd.Text = "Add" + Suffix;'), code, /:11: cannot read this string assignment: "Add" \+ Suffix/);
  failsWith(assign('this.cmdAdd.Tag = @"verbatim";'), code, /:11: cannot read this string assignment: @"verbatim"/);
  failsWith(assign('this.cmdAdd.Text = "unfinished" +'), code, /:12: cannot read this string assignment: this\.cmdAdd\.ContextMenuStrip/);
  equal(parseDesigner(source(assign('this.Text = "The form";')))?.controls.find((item) => item.name === "cmdAdd")?.text, null);
});

test("an item list of the class itself holds controls of the class", () => {
  const parsed = parseDesigner(source(designer.replace("this.Controls.Add(this.splitMain);",
    "this.Controls.AddRange(new System.Windows.Forms.Control[] {\n            this.splitMain,\n            this.cboList});")));
  ok(parsed !== null);
  deepStrictEqual(["splitMain", "cboList"].map((name) => parsed.controls.find((item) => item.name === name)?.parent), ["(self)", "(self)"]);
});

test("the inventory lists every class of a source folder with the hash of what it read", () => {
  const root = mkdtempSync(join(tmpdir(), "inventory-source-"));
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write("Chummer/frmSample.Designer.cs", designer);
  write("Chummer/frmSample.cs", code);
  write("Chummer/Properties/Resources.Designer.cs", "namespace Chummer.Properties { internal class Resources { } }");
  const paths = ["Chummer/frmSample.Designer.cs", "Chummer/Properties/Resources.Designer.cs"];

  const inventory = buildSourceInventory(root, paths);
  deepStrictEqual(inventory.classes.map((item) => item.name), ["frmSample"]);
  deepStrictEqual(inventory.totals, { classes: 1, controls: 7, interactions: 4 });
  equal(buildSourceInventory(root, [...paths].reverse()).sourceSha256, inventory.sourceSha256);
  write("Chummer/frmSample.cs", `${code}\n`);
  ok(buildSourceInventory(root, paths).sourceSha256 !== inventory.sourceSha256);

  write("Chummer/Other/frmSample.Designer.cs", designer);
  write("Chummer/Other/frmSample.cs", code);
  throws(() => buildSourceInventory(root, [...paths, "Chummer/Other/frmSample.Designer.cs"]), /frmSample is declared by Chummer\/Other\/frmSample\.Designer\.cs and Chummer\/frmSample\.Designer\.cs/);
});

test("every designer class of the app parses and every handler is found", () => {
  const inventory = SourceInventorySchema.parse(buildSourceInventory(repositoryRoot, designerPaths(compiledSourcePaths(repositoryRoot, processGit(repositoryRoot)))));
  ok(inventory.classes.length >= 60, `only ${inventory.classes.length} classes`);
  for (const name of ["frmMain", "frmCreate", "frmCareer", "SkillControl"]) ok(inventory.classes.some((item) => item.name === name), `${name} is missing`);
  const create = inventory.classes.find((item) => item.name === "frmCreate")!;
  equal(create.controls.find((item) => item.name === "tabSkills")?.parent, "tabCharacterTabs");
  ok(create.interactions.some((item) => item.id === "frmCreate.tabStreetGearTabs.SelectedIndexChanged"));
});
