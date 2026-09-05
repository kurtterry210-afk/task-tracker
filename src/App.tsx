import { HashRouter, Routes, Route } from 'react-router-dom';
import { ProjectProvider } from './contexts/ProjectContext.tsx';
import { Layout } from './components/Layout.tsx';
import { CalendarPage } from './pages/CalendarPage.tsx';
import { RecordPage } from './pages/RecordPage.tsx';
import { EmployeePage } from './pages/EmployeePage.tsx';
import { ConfigPage } from './pages/ConfigPage.tsx';
import { SummaryPage } from './pages/SummaryPage.tsx';
import { DataPage } from './pages/DataPage.tsx';
import { ProjectPage } from './pages/ProjectPage.tsx';

export function App() {
  return (
    <ProjectProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<CalendarPage />} />
            <Route path="/record/:id" element={<RecordPage />} />
            <Route path="/employees" element={<EmployeePage />} />
            <Route path="/config" element={<ConfigPage />} />
            <Route path="/summary" element={<SummaryPage />} />
            <Route path="/projects" element={<ProjectPage />} />
            <Route path="/data" element={<DataPage />} />
          </Route>
        </Routes>
      </HashRouter>
    </ProjectProvider>
  );
}
