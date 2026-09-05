import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { v4 as uuidv4 } from 'uuid';
import { db, DEFAULT_PROJECT_ID } from '../db/index.ts';
import type { Project } from '../db/index.ts';
import { bjNow } from '../utils/time.ts';

/* ───────────── Context shape ───────────── */

interface ProjectContextValue {
  currentProjectId: string;
  currentProject: Project | undefined;
  allProjects: Project[] | undefined;
  setCurrentProjectId: (id: string) => void;
  createProject: (name: string) => Promise<string>;
  renameProject: (id: string, newName: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
}

const STORAGE_KEY = 'currentProjectId';

const ProjectContext = createContext<ProjectContextValue | null>(null);

/* ───────────── Provider ───────────── */

export function ProjectProvider({ children }: { children: ReactNode }) {
  const allProjects = useLiveQuery(() => db.projects.toArray());

  // Load current project ID from localStorage, fallback to default
  const [currentProjectId, setCurrentProjectIdState] = useState<string>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored || DEFAULT_PROJECT_ID;
  });

  // Persist to localStorage when changed
  const setCurrentProjectId = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    setCurrentProjectIdState(id);
  }, []);

  // Ensure current project exists, fallback to first available or default
  useEffect(() => {
    if (!allProjects || allProjects.length === 0) return;

    const exists = allProjects.some(p => p.id === currentProjectId);
    if (!exists) {
      const fallback = allProjects[0]?.id || DEFAULT_PROJECT_ID;
      setCurrentProjectId(fallback);
    }
  }, [allProjects, currentProjectId, setCurrentProjectId]);

  const currentProject = allProjects?.find(p => p.id === currentProjectId);

  /* ── Create ── */
  const createProject = useCallback(async (name: string): Promise<string> => {
    const id = uuidv4();
    await db.projects.add({
      id,
      name,
      createdAt: bjNow(),
    });
    setCurrentProjectId(id);
    return id;
  }, [setCurrentProjectId]);

  /* ── Rename ── */
  const renameProject = useCallback(async (id: string, newName: string): Promise<void> => {
    await db.projects.update(id, { name: newName });
  }, []);

  /* ── Delete (cascade) ── */
  const deleteProject = useCallback(async (id: string): Promise<void> => {
    if (id === DEFAULT_PROJECT_ID) {
      throw new Error('Cannot delete the default project');
    }

    await db.transaction('rw', [db.projects, db.records, db.tasks, db.taskLogs, db.employees], async () => {
      // 1. Collect record IDs belonging to this project
      const projectRecords = await db.records.where('projectId').equals(id).toArray();
      const recordIds = projectRecords.map(r => r.id);

      // 2. Delete taskLogs for those records
      if (recordIds.length > 0) {
        await db.taskLogs.where('recordId').anyOf(recordIds).delete();
      }

      // 3. Delete tasks for those records
      if (recordIds.length > 0) {
        await db.tasks.where('recordId').anyOf(recordIds).delete();
      }

      // 4. Delete records
      await db.records.where('projectId').equals(id).delete();

      // 5. Delete employees
      await db.employees.where('projectId').equals(id).delete();

      // 6. Delete the project itself
      await db.projects.delete(id);
    });

    // If the deleted project was selected, switch away
    if (currentProjectId === id) {
      setCurrentProjectId(DEFAULT_PROJECT_ID);
    }
  }, [currentProjectId, setCurrentProjectId]);

  /* ── Value ── */
  const value: ProjectContextValue = {
    currentProjectId,
    currentProject,
    allProjects,
    setCurrentProjectId,
    createProject,
    renameProject,
    deleteProject,
  };

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
}

/* ───────────── Hook ───────────── */

export function useProject() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProject must be used within ProjectProvider');
  }
  return context;
}
