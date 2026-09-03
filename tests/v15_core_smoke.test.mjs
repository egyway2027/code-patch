import assert from 'node:assert/strict';
import { detectFileType, parsePatchBlocks } from '../src/patchEngine.js';
assert.equal(detectFileType('main.cpp'),'cpp');
assert.equal(detectFileType('User.java'),'java');
const p=parsePatchBlocks('<<<<<<< SEARCH [PATCH: x]\na\n=======\nb\n>>>>>>> REPLACE');
assert.equal(p.errors.length,0); assert.equal(p.blocks.length,1);
console.log('V21 core smoke: PASS');
