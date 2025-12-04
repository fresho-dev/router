/**
 * Interactive CLI client for the todo API.
 *
 * Start the server first: npm start
 * Then run this:          npm run client
 */

import * as readline from 'node:readline';
import { client } from './server.js';

client.configure({ baseUrl: 'http://localhost:3000' });

async function list(filter?: 'done' | 'pending') {
  const query =
    filter === 'done' ? { completed: true } : filter === 'pending' ? { completed: false } : undefined;
  const result = await client.api.todos(query ? { query } : undefined);
  console.log(`\n${result.count} todo(s):`);
  if (result.todos.length === 0) {
    console.log('  (no todos)\n');
    return;
  }
  for (const t of result.todos) {
    const check = t.completed ? 'x' : ' ';
    console.log(`  [${check}] ${t.id}: ${t.title}`);
  }
  console.log();
}

async function add(title: string) {
  const todo = await client.api.todos.$post({ body: { title } });
  console.log(`\nCreated: [${todo.id}] ${todo.title}\n`);
}

async function done(id: string) {
  try {
    const todo = await client.api.todos.$id.$patch({ path: { id }, body: { completed: true } });
    console.log(`\nMarked done: ${todo.title}\n`);
  } catch {
    console.log(`\nTodo ${id} not found.\n`);
  }
}

async function undo(id: string) {
  try {
    const todo = await client.api.todos.$id.$patch({ path: { id }, body: { completed: false } });
    console.log(`\nMarked pending: ${todo.title}\n`);
  } catch {
    console.log(`\nTodo ${id} not found.\n`);
  }
}

async function rename(id: string, title: string) {
  try {
    const todo = await client.api.todos.$id.$patch({ path: { id }, body: { title } });
    console.log(`\nRenamed to: ${todo.title}\n`);
  } catch {
    console.log(`\nTodo ${id} not found.\n`);
  }
}

async function remove(id: string) {
  try {
    await client.api.todos.$id.$delete({ path: { id } });
    console.log(`\nDeleted todo ${id}.\n`);
  } catch {
    console.log(`\nTodo ${id} not found.\n`);
  }
}

function help() {
  console.log(`
Commands:
  list [done|pending]  List todos (optionally filter by status)
  add <title>          Create a new todo
  done <id>            Mark a todo as completed
  undo <id>            Mark a todo as pending
  rename <id> <title>  Rename a todo
  rm <id>              Delete a todo
  help                 Show this help
  quit                 Exit
`);
}

async function handleCommand(line: string): Promise<boolean> {
  const [cmd, ...args] = line.trim().split(/\s+/);

  try {
    switch (cmd?.toLowerCase()) {
      case 'list':
      case 'ls':
        await list(args[0] as 'done' | 'pending' | undefined);
        break;

      case 'add':
        if (args.length === 0) {
          console.log('Usage: add <title>\n');
        } else {
          await add(args.join(' '));
        }
        break;

      case 'done':
        if (!args[0]) {
          console.log('Usage: done <id>\n');
        } else {
          await done(args[0]);
        }
        break;

      case 'undo':
        if (!args[0]) {
          console.log('Usage: undo <id>\n');
        } else {
          await undo(args[0]);
        }
        break;

      case 'rename':
        if (args.length < 2) {
          console.log('Usage: rename <id> <title>\n');
        } else {
          await rename(args[0], args.slice(1).join(' '));
        }
        break;

      case 'rm':
      case 'delete':
        if (!args[0]) {
          console.log('Usage: rm <id>\n');
        } else {
          await remove(args[0]);
        }
        break;

      case 'help':
      case '?':
        help();
        break;

      case 'quit':
      case 'exit':
      case 'q':
        console.log('Bye!\n');
        return false;

      case '':
      case undefined:
        break;

      default:
        console.log(`Unknown command: ${cmd}. Type "help" for commands.\n`);
    }
  } catch (err) {
    console.log(`Error: ${err instanceof Error ? err.message : err}\n`);
  }

  return true;
}

async function run() {
  console.log('\nTodo CLI - Type "help" for commands\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  process.stdout.write('> ');

  for await (const line of rl) {
    const shouldContinue = await handleCommand(line);
    if (!shouldContinue) {
      rl.close();
      break;
    }
    process.stdout.write('> ');
  }
}

run();
