import { SqliteKnowledgeStore } from '../../packages/user-information/dist/index.js';

const [filename, workerId] = process.argv.slice(2);
const store = new SqliteKnowledgeStore(filename);
process.once('message', async message => {
  try {
    if (message !== 'start') throw new Error('Unexpected worker command');
    for (const requestId of ['shared', ...Array.from({ length: 10 }, (_, i) => `${workerId}:${i}`)]) {
      const event = {
        userId: 'test-user', hostId: 'test-host', sessionId: 'test-session', requestId,
        responseId: `${workerId}:${requestId}`, explainedConceptIds: ['hash-table'], mentionedConceptIds: [],
      };
      await store.recordDelivered(event);
      await store.recordDelivered(event);
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    store.close();
    process.disconnect();
  }
});
process.send('ready');
