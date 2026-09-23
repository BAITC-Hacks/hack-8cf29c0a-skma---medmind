import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Layout } from './Layout';
import { OrdersPage } from '../pages/OrdersPage';
import { DashboardPage } from '../pages/DashboardPage';
import { SettingsPage } from '../pages/SettingsPage';
import { ProductsPage } from '../pages/ProductsPage';
import { SalesHistoryPage } from '../pages/SalesHistoryPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/orders" replace /> },
      { path: 'orders', element: <OrdersPage /> },
      { path: 'products', element: <ProductsPage /> },
      { path: 'sales', element: <SalesHistoryPage /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);
