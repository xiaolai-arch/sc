// Entry point for the fresh-machine first-run-restore e2e only. A truly fresh
// install has no state.json, so the app's default vault resolves to the real
// Documents folder — a restore would then swap directories inside the user's
// real Documents. This wrapper redirects the Documents known folder into a
// temp dir before the real app entry runs, changing nothing else.
const { join } = require('node:path');
const { app } = require('electron');

const override = process.env.STUDY_COACH_E2E_DOCUMENTS_DIR;
if (override) app.setPath('documents', override);

require(join(__dirname, '..', '..', 'out', 'main', 'index.js'));
