export class HiveError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'HiveError';
  }
}

export class ConfigError extends HiveError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}

export class GithubError extends HiveError {
  constructor(message: string) {
    super(message, 'GITHUB_ERROR');
    this.name = 'GithubError';
  }
}

export class ObsidianError extends HiveError {
  constructor(message: string) {
    super(message, 'OBSIDIAN_ERROR');
    this.name = 'ObsidianError';
  }
}
