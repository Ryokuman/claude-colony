type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

function formatLog(entry: LogEntry): string {
  const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
  return `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${ctx}`;
}

function createLogger(minLevel: LogLevel = 'info'): {
  debug: (message: string, context?: Record<string, unknown>) => void;
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
} {
  function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[minLevel]) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context,
    };

    const formatted = formatLog(entry);

    if (level === 'error') {
      process.stderr.write(formatted + '\n');
    } else {
      process.stdout.write(formatted + '\n');
    }
  }

  return {
    debug: (message, context) => log('debug', message, context),
    info: (message, context) => log('info', message, context),
    warn: (message, context) => log('warn', message, context),
    error: (message, context) => log('error', message, context),
  };
}

export const logger = createLogger();
