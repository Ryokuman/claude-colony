export class ColonyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ColonyError';
  }
}

export class ConfigError extends ColonyError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}

export class GithubError extends ColonyError {
  constructor(message: string) {
    super(message, 'GITHUB_ERROR');
    this.name = 'GithubError';
  }
}

export class ObsidianError extends ColonyError {
  constructor(message: string) {
    super(message, 'OBSIDIAN_ERROR');
    this.name = 'ObsidianError';
  }
}

export class AdapterError extends ColonyError {
  constructor(message: string) {
    super(message, 'ADAPTER_ERROR');
    this.name = 'AdapterError';
  }
}
