import { BrowserRouter, Routes, Route } from "react-router-dom";
import Upload from "./routes/Upload";
import List from "./routes/List";
import Detail from "./routes/Detail";
import { ToastProvider } from "./components/ToastProvider";
import { Menubar } from "./components/ui/Menubar";

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Menubar />
        <Routes>
          <Route path="/" element={<Upload />} />
          <Route path="/documents" element={<List />} />
          <Route path="/documents/:id" element={<Detail />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
