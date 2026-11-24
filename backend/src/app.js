import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { authRequired, requireSystemAdmin, workspaceContext } from './middleware/auth.js';
import adminRoutes from './modules/admin.js';
import { errorHandler, notFound } from './lib/http.js';
import authRoutes from './modules/auth.js';
import workspaceRoutes from './modules/workspaces.js';
import classRoutes from './modules/classes.js';
import questionRoutes from './modules/questions.js';
import examRoutes from './modules/exams.js';
import assignmentRoutes from './modules/assignments.js';
import gradingRoutes from './modules/grading.js';
import studentPortalRoutes from './modules/student.js';
import aiRoutes from './modules/ai.js';
import { dashboardRouter, reportsRouter } from './modules/dashboard.js';
import { materialsRouter, notificationsRouter, studentsRouter } from './modules/misc.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  if (config.env !== 'test') app.use(morgan('dev'));

  // File upload (ảnh bài làm, học liệu). Tên file ngẫu nhiên, không liệt kê được.
  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', index: false }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // Không cần workspace
  app.use('/api/auth', authRoutes);
  app.use('/api/workspaces', authRequired, workspaceRoutes);
  app.use('/api/notifications', authRequired, notificationsRouter);
  app.use('/api/student', authRequired, studentPortalRoutes);
  app.use('/api/admin', authRequired, requireSystemAdmin, adminRoutes);

  // Nghiệp vụ theo workspace (header X-Workspace-Id bắt buộc)
  const ws = [authRequired, workspaceContext];
  app.use('/api/dashboard', ws, dashboardRouter);
  app.use('/api/classes', ws, classRoutes);
  app.use('/api/students', ws, studentsRouter);
  app.use('/api/materials', ws, materialsRouter);
  app.use('/api/questions', ws, questionRoutes);
  app.use('/api/exams', ws, examRoutes);
  app.use('/api/assignments', ws, assignmentRoutes);
  app.use('/api/grading', ws, gradingRoutes);
  app.use('/api/reports', ws, reportsRouter);
  app.use('/api/ai', ws, aiRoutes);

  app.use('/api', () => {
    throw notFound('ROUTE_NOT_FOUND');
  });

  // Production: phục vụ luôn bản build của frontend (frontend/dist) => chỉ cần 1 server
  if (fs.existsSync(path.join(config.frontendDist, 'index.html'))) {
    app.use(express.static(config.frontendDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/|uploads\/).*/, (_req, res) => res.sendFile(path.join(config.frontendDist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
