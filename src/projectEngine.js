/** Browser-safe V23 project transaction facade. Filesystem commit lives server-side. */
import { prepareProjectTransaction } from './transactionEngine.js';
export const prepareProject = prepareProjectTransaction;
/** Legacy name retained for editor/in-memory workflows; never writes to disk. */
export async function applyProjectTransaction(entries, options = {}) {
  const prepared = await prepareProjectTransaction(entries, options);
  return prepared.ok ? { ...prepared, committed:false, message:'Project validated and staged in memory; filesystem commit requires the compiler server.' } : prepared;
}
