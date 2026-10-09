import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import express from 'express';
import { AppModule } from './app.module';
import { HttpErrorFilter } from './common/http.filter';
import { enrichOpenAPI } from './common/openapi';
import { readProgrammingPreviewConfiguration } from './programming/programming-preview.service';
const root = resolve(__dirname, '../../..');
config({ path: join(root, '.env') });
async function bootstrap() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  process.env.APP_ORIGIN ||= 'http://localhost:5173';
  if (
    process.env.NODE_ENV === 'production' &&
    (process.env.COOKIE_SECURE !== 'true' || !process.env.APP_ORIGIN.startsWith('https://'))
  )
    throw new Error('Production requires HTTPS APP_ORIGIN and COOKIE_SECURE=true');
  process.env.UPLOAD_DIR = resolve(root, process.env.UPLOAD_DIR || 'uploads');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 5)
    throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 5');
  if (proxyHops) app.set('trust proxy', proxyHops);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          mediaSrc: ["'self'", 'https:'],
          objectSrc: ["'none'"],
          frameSrc: ["'self'", readProgrammingPreviewConfiguration().origin].filter(Boolean),
          upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
        },
      },
    }),
  );
  app.use(cookieParser());
  const requestLimit = `${Math.min(20, Math.max(1, Number(process.env.MAX_JSON_MB) || 2))}mb`;
  app.use((req: any, res: any, next: any) => {
    req.requestId = randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    if (/^\/api(?:\/|$)/i.test(req.path)) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: requestLimit }));
  app.use(express.urlencoded({ extended: false, limit: requestLimit }));
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new HttpErrorFilter());
  app.enableShutdownHooks();
  const options = new DocumentBuilder()
    .setTitle('知学 · 学习管理系统 API')
    .setDescription(
      '同源 Cookie 会话。写请求必须携带登录响应中的 x-csrf-token。所有教学资源逐请求执行机构、当前角色、课程成员资格和对象归属校验。分页 page/pageSize，错误 {error:{code,message,fields,requestId}}。详细参数及示例见 docs/*-api.md。',
    )
    .setVersion('1.0')
    .addCookieAuth('lms_session')
    .build();
  const document = enrichOpenAPI(SwaggerModule.createDocument(app, options));
  for (const [path, methods] of Object.entries(document.paths))
    for (const [method, operation] of Object.entries(methods)) {
      if (!operation || typeof operation !== 'object') continue;
      const op = operation as any;
      op.responses = {
        ...op.responses,
        '400': { description: '字段验证失败' },
        '401': { description: '未登录或会话已失效' },
        '403': { description: '功能、机构、角色上下文或资源范围无权限' },
        '404': { description: '资源不存在' },
        '409': { description: '版本冲突或重复约束' },
      };
      if (
        !['get', 'head', 'options'].includes(method) &&
        !path.endsWith('/auth/login') &&
        !path.endsWith('/auth/recover')
      )
        op.parameters = [
          ...(op.parameters || []),
          { in: 'header', name: 'x-csrf-token', required: true, schema: { type: 'string' } },
        ];
    }
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/openapi.json',
    swaggerOptions: { persistAuthorization: false },
  });
  const web = join(root, 'apps/web/dist');
  if (existsSync(web)) {
    app.use(express.static(web, { index: false }));
    app.use((req: any, res: any, next: any) => {
      if (req.method === 'GET' && !/^\/api(?:\/|$)/i.test(req.path) && !req.path.startsWith('/socket.io'))
        res.sendFile(join(web, 'index.html'));
      else next();
    });
  }
  await app.listen(Number(process.env.PORT) || 3001, process.env.BIND_HOST || '127.0.0.1');
  console.info(
    `Zhixue ready at http://${process.env.BIND_HOST || '127.0.0.1'}:${process.env.PORT || 3001}; Swagger /api/docs`,
  );
}
void bootstrap();
