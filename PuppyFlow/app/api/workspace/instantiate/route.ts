/**
 * Template Instantiation API Endpoint
 *
 * POST /api/workspace/instantiate
 *
 * Creates a new workspace from a template by:
 * 1. Loading the template package
 * 2. Instantiating it with user-specific resources
 * 3. Creating the workspace
 * 4. Saving the instantiated workflow
 *
 * Phase 2-3: Template Loader Implementation
 */

import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getWorkspaceStore } from '@/lib/workspace';
import { getCurrentUserId } from '@/lib/auth/serverUser';
import { extractAuthHeader } from '@/lib/auth/http';
import { TemplateLoaderFactory } from '@/lib/templates/loader';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    // Parse request body
    const body = await request.json();
    const { templateId, workspaceName, availableModels } = body;

    // Validate inputs
    if (!templateId || !workspaceName) {
      console.error(
        '[API:/api/workspace/instantiate] Missing required fields:',
        {
          templateId,
          workspaceName,
        }
      );
      return NextResponse.json(
        { error: 'Missing required fields: templateId and workspaceName' },
        { status: 400 }
      );
    }

    // Get user ID
    const userId = await getCurrentUserId(request);
    console.log(
      `[API:/api/workspace/instantiate] User ${userId} instantiating template: ${templateId}`
    );

    // Create template loader
    const loader = TemplateLoaderFactory.create();

    // Load template
    let pkg;
    try {
      pkg = await loader.loadTemplate(templateId);
      console.log(
        `[API:/api/workspace/instantiate] Loaded template: ${pkg.metadata.name} v${pkg.metadata.version}`
      );
    } catch (error) {
      console.error(
        `[API:/api/workspace/instantiate] Failed to load template ${templateId}:`,
        error
      );
      return NextResponse.json(
        {
          error: `Failed to load template: ${(error as Error).message}`,
          templateId,
        },
        { status: 404 }
      );
    }

    // Generate new workspace ID
    const workspaceId = uuidv4();

    // Instantiate template with user-specific resources
    let content;
    try {
      content = await loader.instantiateTemplate(
        pkg,
        userId,
        workspaceId,
        availableModels || []
      );
      console.log(
        `[API:/api/workspace/instantiate] Template instantiated with ${content.blocks.length} blocks`
      );
    } catch (error) {
      console.error(
        `[API:/api/workspace/instantiate] Failed to instantiate template ${templateId}:`,
        error
      );
      return NextResponse.json(
        {
          error: `Failed to instantiate template: ${(error as Error).message}`,
          templateId,
        },
        { status: 500 }
      );
    }

    // Save instantiated workflow using existing /api/workspace logic
    // This includes retry logic if workspace doesn't exist yet
    const authHeader = extractAuthHeader(request);
    const timestamp = new Date().toISOString();

    try {
      console.log(
        `[API:/api/workspace/instantiate] Saving workflow with ${content.blocks.length} blocks to workspace ${workspaceId}...`
      );

      const store = getWorkspaceStore();

      // Try to save history (will auto-create workspace if needed)
      try {
        await store.addHistory(
          workspaceId,
          { history: content, timestamp },
          authHeader ? { authHeader } : undefined
        );
        console.log(
          `[API:/api/workspace/instantiate] ✅ Saved workflow on first attempt`
        );
      } catch (e: any) {
        // If workspace doesn't exist, create it and retry
        const message = (e?.message || '').toString();
        const isNotFound =
          message.includes('404') || /not\s*exist/i.test(message);

        if (!isNotFound) {
          throw e; // Rethrow if it's not a "not found" error
        }

        console.log(
          `[API:/api/workspace/instantiate] Workspace not found, creating and retrying...`
        );

        // Create workspace
        await store.createWorkspace(
          userId,
          {
            workspace_id: workspaceId,
            workspace_name: workspaceName,
          },
          authHeader ? { authHeader } : undefined
        );

        // Retry saving history
        await store.addHistory(
          workspaceId,
          { history: content, timestamp },
          authHeader ? { authHeader } : undefined
        );

        console.log(
          `[API:/api/workspace/instantiate] ✅ Saved workflow after creating workspace`
        );
      }
    } catch (error) {
      console.error(
        `[API:/api/workspace/instantiate] ❌ Failed to save workflow:`,
        error
      );
      return NextResponse.json(
        {
          error: `Failed to save workflow: ${(error as Error).message}`,
          workspaceId,
          details: 'Could not save template content to workspace',
        },
        { status: 500 }
      );
    }

    // Return success
    console.log(
      `[API:/api/workspace/instantiate] ✅ Successfully instantiated template ${templateId} as workspace ${workspaceId}`
    );

    return NextResponse.json(
      {
        success: true,
        workspace_id: workspaceId,
        template_id: templateId,
        template_name: pkg.metadata.name,
        template_version: pkg.metadata.version,
        blocks_count: content.blocks.length,
        edges_count: content.edges.length,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[API:/api/workspace/instantiate] Unexpected error:', {
      message: (error as any)?.message,
      stack: (error as any)?.stack,
    });
    return NextResponse.json(
      { error: 'Failed to instantiate template' },
      { status: 500 }
    );
  }
}
