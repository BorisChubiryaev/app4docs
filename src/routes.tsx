import { Routes, Route } from "react-router-dom";
import Home from "./pages/HomePage";
import WorkplaceCompare from "./pages/WorkplaceCompare/WorkplaceCompare";
import ComparePage from "./pages/ComparePage/ComparePage";
import HtmlToExcelConverter from "./pages/DownloadExcel/HtmlToExcelConverter";
import Svg2Png from "./pages/Svg2Png/Svg2Png";
import PdfEditor from "./pages/PdfEditor/PdfEditor";
import ChartCraft from "./pages/ChartCraft/ChartCraft";
import ExcelTableBuilder from "./pages/ExcelTableBuilder/ExcelTableBuilder";
import PdfToWord from "./pages/PdfToWord/PdfToWord";
import DocMatchGame from "./pages/DocMatch/DocMatchGame";
import JpgToPdfPage from "./pages/JpgToPdfPage/JpgToPdfPage";
import OfferMerge from "./pages/OfferMerge/OfferMerge";

const RootRoutes = () => {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/WorkplaceCompare" element={<WorkplaceCompare />} />
      <Route path="/compare" element={<ComparePage />} />
      <Route path="/htmlToExcel" element={<HtmlToExcelConverter />} />
      <Route path="/Svg2Png" element={<Svg2Png />} />
      <Route path="/PdfEditor" element={<PdfEditor />} />
      <Route path="/ExcelTableBuilder" element={<ExcelTableBuilder />} />
      <Route path="/ChartCraft" element={<ChartCraft />} />
      <Route path="/PdfToWord" element={<PdfToWord />} />
      <Route path="/DocMatchGame" element={<DocMatchGame />} />
      <Route path="/JpgToPdfPage" element={<JpgToPdfPage />} />
      <Route path="/OfferMerge" element={<OfferMerge />} />
    </Routes>
  );
};

export default RootRoutes;
