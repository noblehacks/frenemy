'use strict';
// Share status interpretation with the panel, including actual watched exit stamps.
const model = require('../extension/lib/model');
const now = Date.now() / 1000;
const rows = model.readJobs(process.argv[2]).map(job => model.decorate(job, now, {}));
if (!rows.length) console.log('no jobs');
for (const row of rows) {
  console.log(`${row.agent}  ${row.title}  ${row.status}  elapsed ${model.formatDur(row.elapsed)}  last activity ${model.formatDur(row.beatAge)} ago`);
}
