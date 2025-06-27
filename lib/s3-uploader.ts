import { S3Client, PutObjectCommand, PutObjectCommandInput } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from './logger';
import crypto from 'crypto';
import path from 'path';

export interface S3Config {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;          // For S3-compatible services like MinIO, DigitalOcean Spaces
  forcePathStyle?: boolean;   // Required for some S3-compatible services
  publicUrlBase?: string;     // Custom public URL base (e.g., CDN domain)
  keyPrefix?: string;         // Optional prefix for all uploaded keys
  signedUrlExpiry?: number;   // Signed URL expiry in seconds (default: 3600)
}

export interface UploadResult {
  success: boolean;
  url?: string;
  key?: string;
  error?: string;
}

export class S3Uploader {
  private client: S3Client;
  private config: S3Config;

  constructor(config: S3Config) {
    this.config = {
      signedUrlExpiry: 3600, // 1 hour default
      ...config
    };

    // Initialize S3 client
    this.client = new S3Client({
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
      endpoint: this.config.endpoint,
      forcePathStyle: this.config.forcePathStyle || false,
    });

    logger.info('S3 uploader initialized', { 
      region: this.config.region, 
      bucket: this.config.bucket,
      endpoint: this.config.endpoint 
    });
  }

  /**
   * Upload a file buffer to S3 with a custom filename
   */
  async uploadFile(
    buffer: Buffer, 
    originalFilename: string, 
    customFilename?: string,
    contentType?: string
  ): Promise<UploadResult> {
    try {
      // Generate filename
      const filename = customFilename || this.generateFilename(originalFilename);
      const key = this.config.keyPrefix ? `${this.config.keyPrefix}/${filename}` : filename;

      // Detect content type if not provided
      if (!contentType) {
        contentType = this.getContentType(filename);
      }

      const uploadParams: PutObjectCommandInput = {
        Bucket: this.config.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        // Make the object publicly readable
        ACL: 'public-read'
      };

      const command = new PutObjectCommand(uploadParams);
      const result = await this.client.send(command);

      // Generate public URL
      const url = this.generatePublicUrl(key);

      logger.info('File uploaded successfully', { 
        key, 
        originalFilename, 
        customFilename, 
        size: buffer.length,
        contentType 
      });

      return {
        success: true,
        url,
        key
      };

    } catch (error) {
      logger.error('S3 upload failed', { 
        originalFilename, 
        customFilename, 
        error: (error as Error).message 
      });

      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Generate a signed URL for private access (if needed)
   */
  async generateSignedUrl(key: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    });

    return await getSignedUrl(this.client, command, { 
      expiresIn: this.config.signedUrlExpiry 
    });
  }

  /**
   * Generate a unique filename while preserving extension
   */
  private generateFilename(originalFilename: string): string {
    const ext = path.extname(originalFilename);
    const basename = path.basename(originalFilename, ext);
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    
    // Sanitize basename for URL safety
    const sanitized = basename
      .replace(/[^a-zA-Z0-9\-_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    
    return `${sanitized}_${timestamp}_${random}${ext}`;
  }

  /**
   * Generate public URL for uploaded file
   */
  private generatePublicUrl(key: string): string {
    if (this.config.publicUrlBase) {
      const baseUrl = this.config.publicUrlBase.replace(/\/$/, '');
      return `${baseUrl}/${key}`;
    }

    if (this.config.endpoint) {
      // S3-compatible service
      const baseUrl = this.config.endpoint.replace(/\/$/, '');
      return `${baseUrl}/${this.config.bucket}/${key}`;
    }

    // Standard AWS S3
    return `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${key}`;
  }

  /**
   * Detect content type based on file extension
   */
  private getContentType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp',
      '.ico': 'image/x-icon',
      '.tiff': 'image/tiff',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.zip': 'application/zip',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav'
    };

    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Validate S3 configuration
   */
  static validateConfig(config: Partial<S3Config>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.region) errors.push('S3 region is required');
    if (!config.bucket) errors.push('S3 bucket name is required');
    if (!config.accessKeyId) errors.push('S3 access key ID is required');
    if (!config.secretAccessKey) errors.push('S3 secret access key is required');

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Test S3 connection and permissions
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      // Try to upload a small test file
      const testBuffer = Buffer.from('test', 'utf8');
      const testKey = this.config.keyPrefix 
        ? `${this.config.keyPrefix}/test_${Date.now()}.txt`
        : `test_${Date.now()}.txt`;

      const command = new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: testKey,
        Body: testBuffer,
        ContentType: 'text/plain',
        ACL: 'public-read'
      });

      await this.client.send(command);
      logger.info('S3 connection test successful', { testKey });

      return { success: true };

    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error('S3 connection test failed', { error: errorMessage });

      return { 
        success: false, 
        error: errorMessage 
      };
    }
  }

  /**
   * Check if a file type is supported for upload
   */
  isSupportedFileType(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    
    // Supported file types - primarily images but also some common file types
    const supportedTypes = [
      '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff',
      '.pdf', '.txt', '.json', '.xml', '.zip', '.mp4', '.mp3', '.wav'
    ];

    return supportedTypes.includes(ext);
  }
}