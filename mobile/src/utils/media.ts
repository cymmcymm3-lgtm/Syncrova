import { BACKEND_ORIGIN } from '../config';
import type { Message, MessageAttachment } from '../types';

const absoluteUrlPattern = /^(https?:|data:|blob:|file:)/i;

export const resolveMediaUrl = (value?: string) => {
  if (!value) return '';
  if (absoluteUrlPattern.test(value)) return value;
  const path = value.startsWith('/') ? value : `/${value}`;
  return `${BACKEND_ORIGIN}${path}`;
};

export const resolveMediaVariantUrl = (asset?: MessageAttachment) => {
  if (!asset) return '';
  const variants = asset.variants || {};
  for (const key of ['feed', 'large', 'thumb']) {
    const variant = variants[key];
    const url = typeof variant === 'string' ? variant : variant?.fileUrl || variant?.url;
    if (url) return resolveMediaUrl(url);
  }
  return resolveMediaUrl(asset.fileUrl);
};

export const getMessageAttachments = (message?: Partial<Message> | null): MessageAttachment[] => {
  if (!message) return [];
  const attachments = Array.isArray(message.attachments)
    ? message.attachments.filter(item => item?.fileUrl)
    : [];
  if (attachments.length) return attachments;
  if (!message.fileUrl) return [];
  return [{
    fileUrl: message.fileUrl,
    fileType: message.fileType,
    fileName: message.fileName,
    mimeType: message.mimeType,
    fileSize: message.fileSize,
    durationMs: message.durationMs,
    storagePath: message.storagePath,
    storageProvider: message.storageProvider,
    variants: message.mediaVariants
  }];
};
