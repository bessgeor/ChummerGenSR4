ChummerGen
-------

"Chummer is a character generator for Shadowrun 4th Edition.
Not only can you create your character quickly and easily,
but you can also use Chummer during your character's shadowrunning career,
to accurately track your Karma, Nuyen, ammo, and everything else all in one place.
Chummer also includes support for a number of optional rules and house rules and even includes
support for critters and is useful for players and Game Masters alike!
It also supports four languages: English, French, German, and Japanese.

Chummer is continuously updated to address bugs and introduce new and interesting features suggested by the community.
If you have a bug to report or idea to suggest, please report them on the issue section by using the link in the menu."

This text is a copy (slightly modified) from http://chummergen.com/

Development
-------

This fork is being modernized in small, reviewable steps with AI coding agents (Claude Code and Codex). The released build, `bin/ChummerGenSR4.exe`, is the reference for correct behavior and is never modified.

Each step is an OpenSpec change (`openspec/`) in its own pull request, with a proposal, spec deltas, tasks and a verification record. To validate the specs and changes (Node.js 20.19 or later):

```
npm install
npm run openspec:validate
```

`npm start` runs the visual parity workflow (`workflow/`, a LangGraph graph): it builds the app from the current source, captures each test character on the released and the rebuilt executable, compares the captures, groups the differences it finds, lists every form, control and event handler of the source with the scope the test characters are meant to reach and which of them the captures showed on screen or provably used (`npm run inventory` does the same for capture runs), has model agents (the Claude Code CLI and Codex, under their subscriptions) explain each group and checks their explanations with one more capture, and then has an agent change a copy of the source for each confirmed explanation, which it builds and captures again on the affected screens. A change that passes is widened without any agent, from those screens to every screen of the character, of the other characters in the same mode and of the whole suite, with each new difference checked against the source before the change; a change that passes every level is committed on a local `accepted/<thread>` branch, and one that fails is dropped and, within a set number of attempts and the run's budget, tried again with the failed changes shown to the agent. Each run ends by saying whether every difference in its scope was fixed (`verified_for_scope`), differences remain, or the budget ran out, with what it spent. With `npm start -- --fix-changes` each fix is also worked as an OpenSpec fix change in the separate `fixes/` root: archived fixes of similar differences are shown to the explaining agent as leads, the change is planned as subtasks that agents implement in parallel, and every committed fix carries its fix change (the difference, the explanation and its evidence, the subtasks and the widening results); `npm run fixes:validate` checks them. `npm run discover -- --from <thread>` looks for new test scenarios: from a finished run's list of the controls and event handlers its captures never showed or used, an agent ranks what a scenario of tab selections could show, an agent proposes one scenario for each of the best, every proposal is checked against the allowed actions before it runs, and the valid ones are captured in one run; only what the recorded UI trees show counts as new coverage, and the scenarios that showed something new or a visual difference are kept in `parity/discovery/registry.json` and its case file `parity/cases/discovered.json`, which `npm start -- --case-file parity/cases/discovered.json` runs, compares and explains like any case. It needs Windows with an interactive desktop, .NET 10 and Visual Studio Build Tools, and for the explanations a signed-in Claude Code CLI and Codex; `AGENTS.md` describes its options and output. `npm run eval` evaluates the agents' answers: labels from the checks, from accepted fixes and from human review (`npm run review` serves a local review page), frozen datasets, repeatable eval runs, paired comparisons with confidence intervals (of eval runs, and of finished workflow runs by their fix rate and model time), and certificates without which `npm start -- --unattended` and `npm run discover -- --unattended` do not run the agents. A GitHub Actions job type-checks and tests the workflow, builds the parity tools and checks the generated contracts.
