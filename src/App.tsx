import { useState } from 'react';
import { Amplify } from 'aws-amplify';
import outputs from '../amplify_outputs.json';
import { ThemeProvider } from '@/components/ThemeProvider';
import { Toaster } from '@/components/ui/sonner';
import { PurchaseRegistrationPage } from '@/features/purchase/components/PurchaseRegistrationPage';
import { DrinkingRegistrationPage } from '@/features/drinking/components/DrinkingRegistrationPage';
import { RecordListPage } from '@/features/records/components/RecordListPage';

Amplify.configure(outputs);

type Page = 'purchase' | 'drinking' | 'records';

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('purchase');

  return (
    <ThemeProvider>
      {/* Navigation Tabs */}
      <nav className="sticky top-0 z-50 border-b border-gray-200 bg-white/80 backdrop-blur-md dark:border-white/10 dark:bg-dark-bg/80">
        <div className="mx-auto flex max-w-md">
          <button
            onClick={() => setCurrentPage('purchase')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              currentPage === 'purchase'
                ? 'border-b-2 border-sake-gold text-sake-gold'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            🛒 購入登録
          </button>
          <button
            onClick={() => setCurrentPage('drinking')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              currentPage === 'drinking'
                ? 'border-b-2 border-sake-gold text-sake-gold'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            🍶 飲酒登録
          </button>
          <button
            onClick={() => setCurrentPage('records')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              currentPage === 'records'
                ? 'border-b-2 border-sake-gold text-sake-gold'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            📋 記録一覧
          </button>
        </div>
      </nav>

      {/* Page Content */}
      {currentPage === 'purchase' ? (
        <PurchaseRegistrationPage />
      ) : currentPage === 'drinking' ? (
        <DrinkingRegistrationPage />
      ) : (
        <RecordListPage />
      )}

      <Toaster />
    </ThemeProvider>
  );
}

export default App;
