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

`npm start` runs the visual parity workflow (`workflow/`, a LangGraph graph): it builds the app from the current source, captures each test character on the released and the rebuilt executable, compares the captures, groups the differences it finds, and has model agents (the Claude Code CLI and Codex, under their subscriptions) explain each group and checks their explanations with one more capture. It needs Windows with an interactive desktop, .NET 10 and Visual Studio Build Tools, and for the explanations a signed-in Claude Code CLI and Codex; `AGENTS.md` describes its options and output. `npm run eval` evaluates the agents' answers: labels from the checks, from accepted fixes and from human review (`npm run review` serves a local review page), frozen datasets, repeatable eval runs, paired comparisons with confidence intervals, and certificates without which `npm start -- --unattended` does not run the agents. A GitHub Actions job type-checks and tests the workflow, builds the parity tools and checks the generated contracts.
