export interface TemplateData {
  projectName: string;
  projectSlug: string;
  projectId: string;
  templateVersion: string;
  launchpadVersion: string;
  createdAt: string;
  supabaseStagingProjectId: string;
  supabaseProdProjectId: string;
  githubOwner: string;
}

export interface TemplateFile {
  path: string;
  content: string;
}
