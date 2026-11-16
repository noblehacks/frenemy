#!/usr/bin/env node
// Give agy one piece of work: the full-rights seat. agy may write files and run commands
// without asking.
//   node ask-agy.mjs "PROMPT"      or the prompt on standard input
// AGY_BIN, AGY_TIMEOUT (seconds, 0 = no limit), AGY_LOG_FILE and FRENEMY_DRIVER are honoured.
// Exit: agy's own code, or 2 bad prompt or usage, 3 no scratch file, 75 Google quota reached,
// 124 timed out, 127 agy not found.
import { runAgy } from './tools/wrapper-common.mjs';

runAgy({ name: 'ask-agy', fullRights: true });
