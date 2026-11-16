#!/usr/bin/env node
// Ask agy one question: the consult seat. agy answers and can search, but its file-writing and
// shell tools are not pre-approved.
//   node tools/ask-agy-consult.mjs "PROMPT"      or the prompt on standard input
// AGY_BIN, AGY_TIMEOUT (seconds, 0 = no limit), AGY_LOG_FILE and FRENEMY_DRIVER are honoured.
// Exit: agy's own code, or 2 bad prompt or usage, 3 no scratch file, 75 Google quota reached,
// 124 timed out, 127 agy not found.
import { runAgy } from './wrapper-common.mjs';

runAgy({ name: 'ask-agy-consult', fullRights: false });
