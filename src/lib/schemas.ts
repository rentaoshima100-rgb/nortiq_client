import { z } from 'zod';

/** 設計 6.7 の locator */
export const LocatorSchema = z.object({
  nqId: z.string().max(64).nullable(),
  nqOrdinal: z.number().int().nullable(),
  nqCount: z.number().int().nullable(),
  sourceRef: z.string().max(512).nullable(),
  tag: z.string().max(32),
  textHash: z.string().max(80).nullable(),
  textSample: z.string().max(400),
  cssPath: z.string().max(1024),
  bbox: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  }),
  viewportW: z.number().int(),
  docHeight: z.number().int(),
  srcAttr: z.string().max(4096).nullable().optional(),
});

/** 設計 6.8 の target（img / picture のときだけ） */
export const TargetSchema = z
  .object({
    srcAttr: z.string().max(4096).nullable(),
    srcset: z.string().max(8192).nullable(),
    currentSrc: z.string().max(4096).nullable(),
    naturalW: z.number().int().nullable(),
    naturalH: z.number().int().nullable(),
  })
  .nullable();

export const MatchedRuleSchema = z.object({
  href: z.string().max(2048).nullable(),
  selector: z.string().max(1024),
  cssText: z.string().max(600),
});

export const CreateRequestSchema = z.object({
  projectKey: z.string().min(1).max(128),
  body: z.string().min(1).max(4000),
  pagePath: z.string().max(1024),
  siteSha: z.string().max(64).nullable().optional(),
  viewport: z.object({
    w: z.number().int().min(1).max(10000),
    h: z.number().int().min(1).max(20000),
    dpr: z.number().min(0.1).max(10),
  }),
  scrollY: z.number().int().min(0).max(2_000_000),
  locator: LocatorSchema,
  target: TargetSchema.optional(),
  outerHTML: z.string().max(16384).optional(),
  computed: z.record(z.string(), z.string().max(512)).optional(),
  cssRules: z.array(MatchedRuleSchema).max(20).optional(),
  ua: z.string().max(512).optional(),
});

export const SignAttachmentSchema = z.object({
  projectKey: z.string().min(1).max(128),
  requestId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']),
  bytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
  kind: z.enum(['material', 'reference']),
});
