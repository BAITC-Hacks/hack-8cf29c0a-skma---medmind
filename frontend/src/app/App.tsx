import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { ThemeProvider } from '../shared/theme/ThemeContext';
import { CalcRunProvider } from '../shared/calc-run/CalcRunContext';

const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CalcRunProvider>
          <RouterProvider router={router} />
        </CalcRunProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
