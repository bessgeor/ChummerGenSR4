## ADDED Requirements

### Requirement: Unattended runs need certificates
`npm start -- --unattended` SHALL, before any node runs and again whenever the thread is resumed, require for each job kind that the run's diagnosis dispatches (`hypothesis` and `challenge`; none with `--no-diagnosis` or with `--only` of a node before diagnosis) a certificate in the certificates folder (the profile's `certificates`, else `workflow/evals/certificates/`) that is valid and names the thread's provider, model and effort for that job kind and the prompt version the code uses. A missing, invalid or differing certificate SHALL end the run with status 3 naming each job kind and the reason, before the build. A resumed thread SHALL keep `--unattended`. Without `--unattended` no certificate SHALL be required.

#### Scenario: No certificate
- **WHEN** `npm start -- --unattended` runs and the certificates folder has no `challenge.json`
- **THEN** the run ends with status 3 naming `challenge` before the build, and nothing is captured

#### Scenario: Certificate for another effort
- **WHEN** the hypothesis certificate names effort `low` and the profile runs hypotheses with effort `medium`
- **THEN** the run ends with status 3 naming `hypothesis` and both efforts

#### Scenario: Diagnosis turned off
- **WHEN** `npm start -- --unattended --no-diagnosis` runs without certificates
- **THEN** the run starts
