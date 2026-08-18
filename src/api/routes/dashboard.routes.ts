import type { FastifyInstance, FastifyReply } from 'fastify';
import { getValidAuthUser } from '../auth.middleware';
import { projectProviderRepository } from '../../db/repositories/project-provider.repository';
import { projectRepository } from '../../db/repositories/project.repository';
import { testCaseRepository } from '../../db/repositories/test-case.repository';
import type {
  Project,
  ProjectProviderPublic,
  TestCaseWithLatestAnalysis,
} from '../../db/repositories/types';

interface DashboardProject extends Project {
  testCases: TestCaseWithLatestAnalysis[];
  providers: ProjectProviderPublic[];
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
      testCases: await testCaseRepository.findAllWithLatestAnalysis(project.id),
      providers: await projectProviderRepository.findPublicByProjectId(project.id),
    })),
  );
}

/**
 * Keterangan: Merender halaman generate full-width; instruction kosong
 * dikembalikan ke dashboard supaya generate tidak jalan tanpa prompt.
 */
async function renderGeneratePage(
  projectId: string,
  reply: FastifyReply,
) {
  const project = await projectRepository.findById(projectId);
  if (!project || !project.instruction?.trim()) {
    return reply.redirect('/dashboard');
  }
  return reply.view('generate.ejs', { project });
}

/**
 * Keterangan: Mendaftarkan gerbang `/`, halaman login, dashboard, dan
 * halaman generate test script. Dilindungi JWT via cookie/Bearer.
 */
export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (request, reply) => {
    if (getValidAuthUser(request)) {
      return reply.redirect('/dashboard');
    }
    return reply.redirect('/dashboard/login');
  });

  app.get('/dashboard/login', async (_request, reply) => {
    return reply.view('login.ejs');
  });

  app.get('/dashboard', async (_request, reply) => {
    return reply.view('dashboard.ejs', {
      projects: await getDashboardProjects(),
    });
  });

  app.get('/dashboard/projects/:id/generate', async (request, reply) => {
    const { id } = request.params as { id: string };
    return renderGeneratePage(id, reply);
  });
}
