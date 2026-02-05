import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const consoleEnabled = process.env.NODE_ENV === 'test' ? false : process.env.DEBUG_VOICE !== '0';
const fileEnabled = process.env.NODE_ENV === 'test' ? false : process.env.LOG_TO_FILE !== '0';
const logFile = process.env.LOG_FILE ?? 'logs/voice.log';
let fileReady = false;

type Level = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

function pad(num: number, size = 2) {
  return num.toString().padStart(size, '0');
}

function localTs() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const HH = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  const ms = pad(d.getMilliseconds(), 3);
  return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}.${ms}`;
}

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
  const ts = localTs();
  const tag = color(level);
  return [`[${ts}] ${tag}`, ...args];
}

function writeFileLog(level: Level, args: unknown[]) {
  if (!fileEnabled) return;
  if (!fileReady) {
    mkdirSync(dirname(logFile), { recursive: true });
    fileReady = true;
  }
  const ts = localTs();
  const tag = color(level);
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
  appendFileSync(logFile, `[${ts}] ${tag} ${msg}\n`, 'utf8');
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
