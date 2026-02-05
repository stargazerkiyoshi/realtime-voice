import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const consoleEnabled = process.env.NODE_ENV === 'test' ? false : process.env.DEBUG_VOICE !== '0';
const fileEnabled = process.env.NODE_ENV === 'test' ? false : process.env.LOG_TO_FILE !== '0';
const logFile = process.env.LOG_FILE ?? 'logs/voice.log';
let fileReady = false;

function fmt(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', args: unknown[]) {
  const ts = new Date().toISOString();
  return [`[${ts}] [${level}]`, ...args];
}

function writeFileLog(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', args: unknown[]) {
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
