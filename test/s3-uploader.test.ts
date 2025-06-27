import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { S3Uploader, S3Config } from '../lib/s3-uploader';

// Mock AWS SDK
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({
    send: vi.fn()
  })),
  PutObjectCommand: vi.fn()
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(() => Promise.resolve('https://signed-url.example.com'))
}));

describe('S3Uploader', () => {
  let s3Config: S3Config;
  let uploader: S3Uploader;

  beforeEach(() => {
    s3Config = {
      region: 'us-east-1',
      bucket: 'test-bucket',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key'
    };
    
    // Don't initialize uploader here to allow for different configs per test
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Configuration Validation', () => {
    it('should validate complete S3 config', () => {
      const validation = S3Uploader.validateConfig(s3Config);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should reject incomplete S3 config', () => {
      const incompleteConfig = { region: 'us-east-1' };
      const validation = S3Uploader.validateConfig(incompleteConfig);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('S3 bucket name is required');
      expect(validation.errors).toContain('S3 access key ID is required');
      expect(validation.errors).toContain('S3 secret access key is required');
    });

    it('should handle empty config', () => {
      const validation = S3Uploader.validateConfig({});
      expect(validation.valid).toBe(false);
      expect(validation.errors).toHaveLength(4);
    });
  });

  describe('File Type Support', () => {
    beforeEach(() => {
      uploader = new S3Uploader(s3Config);
    });

    it('should support common image types', () => {
      expect(uploader.isSupportedFileType('image.jpg')).toBe(true);
      expect(uploader.isSupportedFileType('image.png')).toBe(true);
      expect(uploader.isSupportedFileType('image.gif')).toBe(true);
      expect(uploader.isSupportedFileType('image.webp')).toBe(true);
    });

    it('should support other document types', () => {
      expect(uploader.isSupportedFileType('document.pdf')).toBe(true);
      expect(uploader.isSupportedFileType('data.json')).toBe(true);
      expect(uploader.isSupportedFileType('text.txt')).toBe(true);
    });

    it('should reject unsupported file types', () => {
      expect(uploader.isSupportedFileType('script.exe')).toBe(false);
      expect(uploader.isSupportedFileType('unknown')).toBe(false);
      expect(uploader.isSupportedFileType('file.xyz')).toBe(false);
    });

    it('should handle files without extensions', () => {
      expect(uploader.isSupportedFileType('filename')).toBe(false);
    });
  });

  describe('Filename Generation', () => {
    beforeEach(() => {
      uploader = new S3Uploader(s3Config);
    });

    it('should generate unique filenames', () => {
      const buffer = Buffer.from('test content');
      
      // Generate multiple filenames
      const filename1 = (uploader as any).generateFilename('test.jpg');
      const filename2 = (uploader as any).generateFilename('test.jpg');
      
      expect(filename1).not.toBe(filename2);
      expect(filename1).toMatch(/test_\d+_[a-f0-9]{8}\.jpg/);
      expect(filename2).toMatch(/test_\d+_[a-f0-9]{8}\.jpg/);
    });

    it('should sanitize filenames', () => {
      const filename = (uploader as any).generateFilename('test file@#$%.jpg');
      expect(filename).toMatch(/test_file_\d+_[a-f0-9]{8}\.jpg/);
    });

    it('should preserve file extensions', () => {
      const filename = (uploader as any).generateFilename('image.PNG');
      expect(filename).toMatch(/\.PNG$/);
    });

    it('should handle files without extensions', () => {
      const filename = (uploader as any).generateFilename('filename');
      expect(filename).toMatch(/filename_\d+_[a-f0-9]{8}$/);
    });
  });

  describe('Content Type Detection', () => {
    beforeEach(() => {
      uploader = new S3Uploader(s3Config);
    });

    it('should detect image content types', () => {
      expect((uploader as any).getContentType('image.jpg')).toBe('image/jpeg');
      expect((uploader as any).getContentType('image.png')).toBe('image/png');
      expect((uploader as any).getContentType('image.gif')).toBe('image/gif');
    });

    it('should detect document content types', () => {
      expect((uploader as any).getContentType('document.pdf')).toBe('application/pdf');
      expect((uploader as any).getContentType('data.json')).toBe('application/json');
      expect((uploader as any).getContentType('text.txt')).toBe('text/plain');
    });

    it('should handle unknown extensions', () => {
      expect((uploader as any).getContentType('file.unknown')).toBe('application/octet-stream');
    });

    it('should be case insensitive', () => {
      expect((uploader as any).getContentType('IMAGE.JPG')).toBe('image/jpeg');
      expect((uploader as any).getContentType('Document.PDF')).toBe('application/pdf');
    });
  });

  describe('URL Generation', () => {
    it('should generate standard AWS S3 URLs', () => {
      uploader = new S3Uploader(s3Config);
      const url = (uploader as any).generatePublicUrl('test/file.jpg');
      expect(url).toBe('https://test-bucket.s3.us-east-1.amazonaws.com/test/file.jpg');
    });

    it('should generate URLs with custom endpoint', () => {
      const configWithEndpoint = {
        ...s3Config,
        endpoint: 'https://nyc3.digitaloceanspaces.com'
      };
      uploader = new S3Uploader(configWithEndpoint);
      const url = (uploader as any).generatePublicUrl('test/file.jpg');
      expect(url).toBe('https://nyc3.digitaloceanspaces.com/test-bucket/test/file.jpg');
    });

    it('should generate URLs with custom public URL base', () => {
      const configWithCustomUrl = {
        ...s3Config,
        publicUrlBase: 'https://cdn.example.com'
      };
      uploader = new S3Uploader(configWithCustomUrl);
      const url = (uploader as any).generatePublicUrl('test/file.jpg');
      expect(url).toBe('https://cdn.example.com/test/file.jpg');
    });

    it('should handle trailing slashes in custom URLs', () => {
      const configWithTrailingSlash = {
        ...s3Config,
        publicUrlBase: 'https://cdn.example.com/',
        endpoint: 'https://s3.example.com/'
      };
      uploader = new S3Uploader(configWithTrailingSlash);
      const url = (uploader as any).generatePublicUrl('test/file.jpg');
      expect(url).toBe('https://cdn.example.com/test/file.jpg');
    });
  });

  describe('Configuration Loading', () => {
    it('should prefer explicit config over defaults', () => {
      const configWithDefaults = {
        ...s3Config,
        signedUrlExpiry: 7200 // 2 hours
      };
      uploader = new S3Uploader(configWithDefaults);
      expect((uploader as any).config.signedUrlExpiry).toBe(7200);
    });

    it('should use default values when not specified', () => {
      uploader = new S3Uploader(s3Config);
      expect((uploader as any).config.signedUrlExpiry).toBe(3600); // 1 hour default
    });

    it('should handle optional configuration', () => {
      const minimalConfig = {
        ...s3Config,
        keyPrefix: 'uploads/',
        forcePathStyle: true
      };
      uploader = new S3Uploader(minimalConfig);
      expect((uploader as any).config.keyPrefix).toBe('uploads/');
      expect((uploader as any).config.forcePathStyle).toBe(true);
    });
  });
});