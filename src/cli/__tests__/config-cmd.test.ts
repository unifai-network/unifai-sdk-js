import * as fs from 'fs';

jest.mock('fs');
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('config command', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation();
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    process.env = { ...originalEnv };
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.mkdirSync.mockReturnValue(undefined);
    mockedFs.writeFileSync.mockReturnValue(undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    process.env = originalEnv;
  });

  function setupProgram() {
    const { Command } = require('commander');
    const { registerConfigCommand } = require('../commands/config-cmd');
    const program = new Command();
    program.option('--config <path>').option('--api-key <key>').option('--endpoint <url>').option('--timeout <ms>');
    registerConfigCommand(program);
    return program;
  }

  describe('config init', () => {
    it('should write config file with 0o600 permissions', async () => {
      const program = setupProgram();
      await program.parseAsync(['node', 'test', 'config', 'init', '--path', '/tmp/test-config.yaml']);

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith('/tmp', { recursive: true });
      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        '/tmp/test-config.yaml',
        expect.stringContaining('UnifAI CLI Configuration'),
        { mode: 0o600 },
      );
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Config file created'));
    });

    it('should skip existing file without --force', async () => {
      mockedFs.existsSync.mockReturnValue(true);

      const program = setupProgram();
      await program.parseAsync(['node', 'test', 'config', 'init', '--path', '/tmp/test-config.yaml']);

      expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('already exists'));
      expect(exitSpy).toHaveBeenCalledWith(2);
    });

    it('should overwrite existing file with --force', async () => {
      mockedFs.existsSync.mockReturnValue(true);

      const program = setupProgram();
      await program.parseAsync(['node', 'test', 'config', 'init', '--path', '/tmp/test-config.yaml', '--force']);

      expect(mockedFs.writeFileSync).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Config file created'));
    });
  });

  describe('config show', () => {
    it('should show configuration in human format', async () => {
      process.env.UNIFAI_AGENT_API_KEY = 'secret-key';

      const program = setupProgram();
      await program.parseAsync(['node', 'test', 'config', 'show']);

      // Should mask secret keys
      const output = logSpy.mock.calls[0][0];
      expect(output).toContain('apiKey: configured');
      expect(output).not.toContain('secret-key');
    });

    it('should show configuration as JSON with --json', async () => {
      process.env.UNIFAI_AGENT_API_KEY = 'secret-key';

      const program = setupProgram();
      await program.parseAsync(['node', 'test', 'config', 'show', '--json']);

      const output = logSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.apiKey.value).toBe('configured');
      expect(parsed.apiKey.source).toBe('env');
    });
  });
});
