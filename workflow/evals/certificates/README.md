# Certificates

`npm run eval -- certify` writes `<job kind>.json` here when an eval run on a dataset's test partition meets the threshold asked for. A certificate names the job kind's provider, model, effort and prompt version; `npm start -- --unattended` runs diagnosis only when the certificates of `hypothesis` and `challenge` name the configuration the run uses. The local profile's `certificates` setting can point to another folder.
