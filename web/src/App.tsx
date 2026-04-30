import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from 'sonner';
import Desktop from '@/components/desktop/Desktop';

function App() {
  return (
    <TooltipProvider>
      <Desktop />
      <Toaster position="top-center" richColors />
    </TooltipProvider>
  );
}

export default App;
