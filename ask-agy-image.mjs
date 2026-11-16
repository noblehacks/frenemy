#!/usr/bin/env node
// Ask agy for one picture and put it at the path given.
//   node ask-agy-image.mjs "PROMPT" /absolute/output.png
// All of the work is in tools/agy-image-delivery.mjs, which runs here in this same process.
import './tools/agy-image-delivery.mjs';
