import { prisma, type Layout, type TemplateVersion } from '@pingx/db';
import { AppError } from '@pingx/shared';
import { renderTemplate } from '@pingx/templates';

export async function findTemplateForSend(userId: string, ref: string) {
  const template = await prisma.template.findFirst({
    where: { userId, OR: [{ id: ref }, { slug: ref }] },
    include: { layout: true },
  });
  if (!template) throw new AppError('template_not_found', 404, `Template "${ref}" not found`);
  const version = await prisma.templateVersion.findUniqueOrThrow({
    where: { templateId_version: { templateId: template.id, version: template.currentVersion } },
  });
  return { template, version };
}

export const renderVersion = (
  version: Pick<TemplateVersion, 'subject' | 'body' | 'format' | 'text'>,
  layout: Pick<Layout, 'body' | 'format'> | null | undefined,
  data: Record<string, unknown>,
) => renderTemplate(version, data, layout);

/** Layouts a user may attach: their own or system ones. */
export async function assertLayoutAccess(userId: string | null, layoutId: string | null | undefined) {
  if (!layoutId) return;
  const layout = await prisma.layout.findFirst({
    where: { id: layoutId, OR: [{ isSystem: true }, ...(userId ? [{ userId }] : [])] },
  });
  if (!layout) throw new AppError('layout_not_found', 404, 'Layout not found');
}
