import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const consoleEnabled = process.env.NODE_ENV === 'test' ? false : process.env.DEBUG_VOICE !== '0';
const fileEnabled = process.env.NODE_ENV === 'test' ? false : process.env.LOG_TO_FILE !== '0';
const logFile = process.env.LOG_FILE ?? 'logs/voice.log';
let fileReady = false;

type Level = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

function color(level: Level) {
  const reset = '\x1b[0m';
  const colors: Record<Level, string> = {
    INFO: '\x1b[34m', // blue
    DEBUG: '\x1b[95m', // bright magenta
    WARN: '\x1b[33m', // yellow
    ERROR: '\x1b[31m' // red
  };
  return `${colors[level]}[${level}]${reset}`;
}

function fmt(level: Level, args: unknown[]) {
  const ts = new Date().toISOString();
  const tag = color(level);
  return [`[${ts}] ${tag}`, ...args];
}

function writeFileLog(level: Level, args: unknown[]) {
  if (!fileEnabled) return;
  if (!fileReady) {
    mkdirSync(dirname(logFile), { recursive: true });
    fileReady = true;
  }
  const ts = new Date().toISOString();
  const msg = args
    .map((v) => {
      if (typeof v === 'string') return v;
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    })
    .join(' ');
  appendFileSync(logFile, `[${ts}] [${level}] ${msg}\n`, 'utf8');
}

export const logger = {
  info: (...args: unknown[]) => {
    if (consoleEnabled) console.log(...fmt('INFO', args));
    writeFileLog('INFO', args);
  },
  warn: (...args: unknown[]) => {
    if (consoleEnabled) console.warn(...fmt('WARN', args));
    writeFileLog('WARN', args);
  },
  error: (...args: unknown[]) => {
    if (consoleEnabled) console.error(...fmt('ERROR', args));
    writeFileLog('ERROR', args);
  },
  debug: (...args: unknown[]) => {
    if (consoleEnabled) console.log(...fmt('DEBUG', args));
    writeFileLog('DEBUG', args);
  }
};
