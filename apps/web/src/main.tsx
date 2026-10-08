import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { AuthProvider } from './auth';
import { Root } from './root';
import { appTheme } from './theme';
import './styles.css';
import './tabler.css';
import './workflows.css';
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 20000, refetchOnWindowFocus: true } },
});
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={appTheme}>
      <App>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <BrowserRouter>
              <Root />
            </BrowserRouter>
          </AuthProvider>
        </QueryClientProvider>
      </App>
    </ConfigProvider>
  </React.StrictMode>,
);
