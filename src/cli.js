import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import { loadConfig, defaultConfigPath, ROOT } from './config.js';
import { Registry } from './registry.js';
import { LogStore } from './logStore.js';
import {
  helpText,
  cmdRefresh,
  cmdShowServer,
  cmdShowTeam,
  cmdChat,
  cmdShowLog,
  cmdStub,
  parseServerTeamArgs,
} from './commands.js';

function print(msg) {
  console.log(msg);
}

function buildCompleter(registry, pendingChat) {
  return (line) => {
    const hits = [];
    if (pendingChat) {
      return [[], line];
    }
    if (line.startsWith('/chat ') || line.startsWith('/show-team ') || line.startsWith('/obs ')) {
      const parts = line.split(/\s+/);
      const cmd = parts[0];
      if (parts.length <= 2 && !line.includes('/')) {
        const prefix = parts[1] || '';
        const tokens = registry.serverTokens().filter((t) => t.startsWith(prefix));
        return [tokens.map((t) => `${cmd} ${t}`), line];
      }
      const after = line.slice(cmd.length).trim();
      const { server: sTok } = parseServerTeamArgs(after.replace(/\/$/, ''));
      const server = registry.findServer(sTok);
      if (server && (line.endsWith('/') || /\/\S*$/.test(line))) {
        const m = line.match(/\/([^/\s]*)$/);
        const prefix = m ? m[1] : '';
        const teams = registry.teamTokens(server).filter((t) => t.startsWith(prefix));
        const base = line.replace(/\/[^/\s]*$/, '/');
        return [teams.map((t) => base + t), line];
      }
    }
    if (line.startsWith('/')) {
      const cmds = [
        '/chat',
        '/show-server',
        '/show-team',
        '/refresh',
        '/show-log',
        '/restart-server',
        '/obs',
        '/help',
        '/quit',
        '/exit',
      ];
      return [cmds.filter((c) => c.startsWith(line)), line];
    }
    return [hits, line];
  };
}

export async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    const example = path.join(ROOT, 'config', 'servers.example.json');
    const dest = defaultConfigPath();
    if (fs.existsSync(example) && !fs.existsSync(dest)) {
      fs.copyFileSync(example, dest);
      print(`Created ${dest} from example.`);
      config = loadConfig(dest);
    } else {
      throw err;
    }
  }

  const registry = new Registry(config.servers);
  const logs = new LogStore();
  const ctx = { registry, logs, configPath: config.path };

  print(`WorkPanelConnecter CLI v0.1`);
  print(`Config: ${config.path}`);
  print(`Type /help — probing coordinators...`);
  print(await cmdRefresh(ctx));

  let pendingChat = null; // { server, team }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'connecter> ',
    completer: (line) => buildCompleter(registry, pendingChat)(line),
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    try {
      if (pendingChat) {
        if (!input) {
          print('(empty prompt cancelled)');
          pendingChat = null;
          rl.setPrompt('connecter> ');
          rl.prompt();
          return;
        }
        const { server, team } = pendingChat;
        pendingChat = null;
        rl.setPrompt('connecter> ');
        const { message } = await cmdChat(ctx, server, team, input);
        print(message);
        rl.prompt();
        return;
      }

      if (!input) {
        rl.prompt();
        return;
      }

      if (input === '/quit' || input === '/exit') {
        rl.close();
        return;
      }
      if (input === '/help' || input === '/?') {
        print(helpText());
        rl.prompt();
        return;
      }
      if (input === '/refresh') {
        print(await cmdRefresh(ctx));
        rl.prompt();
        return;
      }
      if (input === '/show-server') {
        print(cmdShowServer(ctx));
        rl.prompt();
        return;
      }
      if (input.startsWith('/show-log')) {
        const n = Number(input.slice('/show-log'.length).trim());
        print(cmdShowLog(ctx, n));
        rl.prompt();
        return;
      }
      if (input.startsWith('/show-team')) {
        const args = input.slice('/show-team'.length);
        const { server, team } = parseServerTeamArgs(args);
        if (!server) {
          print('Usage: /show-team {server} [/{team}]');
        } else {
          print(cmdShowTeam(ctx, server, team));
        }
        rl.prompt();
        return;
      }
      if (input.startsWith('/chat')) {
        const args = input.slice('/chat'.length);
        const { server, team } = parseServerTeamArgs(args);
        if (!server || !team) {
          print('Usage: /chat {server} /{team}   then enter prompt on next line');
          rl.prompt();
          return;
        }
        pendingChat = { server, team };
        rl.setPrompt(`prompt(${server}/${team})> `);
        print('Enter prompt (empty line cancels):');
        rl.prompt();
        return;
      }
      if (input.startsWith('/restart-server')) {
        print(cmdStub('/restart-server'));
        rl.prompt();
        return;
      }
      if (input.startsWith('/obs')) {
        print(cmdStub('/obs'));
        rl.prompt();
        return;
      }

      print(`Unknown command. ${helpText()}`);
    } catch (err) {
      print(`Error: ${err.message || err}`);
    }
    rl.prompt();
  });

  rl.on('close', () => {
    print('bye');
    process.exit(0);
  });
}
