import type { FastifyInstance } from 'fastify';
import { projectRepository } from '../../db/repositories/project.repository';
import { testCaseRepository } from '../../db/repositories/test-case.repository';
import type { Project, TestCase } from '../../db/repositories/types';

interface DashboardProject extends Project {
  testCases: TestCase[];
}

/**
 * Keterangan: Mengambil seluruh project beserta test case masing-masing untuk
 * satu render awal dashboard EJS.
 */
async function getDashboardProjects(): Promise<DashboardProject[]> {
  const projects = await projectRepository.findAll();
  return Promise.all(
    projects.map(async (project) => ({
      ...project,
      testCases: await testCaseRepository.findAll({ projectId: project.id }),
    })),
  );
}

/**
 * Keterangan: Mendaftarkan halaman login dashboard dan dashboard utama.
 * Dashboard utama dilindungi middleware JWT global melalui cookie login.
 */
export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dashboard/login', async (_request, reply) => {
    return reply.view('login.ejs');
  });

  app.get('/dashboard', async (_request, reply) => {
    return reply.view('dashboard.ejs', {
      projects: await getDashboardProjects(),
    });
  });
}
