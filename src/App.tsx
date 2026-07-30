import { Link, Outlet } from 'react-router-dom';
import './App.css';

function App() {
  return (
    <div className="App">
      <nav>
        <Link to='/'>Home</Link>
        <Link to='/WorkplaceCompare'>Transform Excel</Link>
        <Link to='/compare'>Compare Excel</Link>
        <Link to='/VPR4Excel'>VPR4Excel</Link>
        <Link to='/htmlToExcel'>HTMLtoEXCEL</Link>
        <Link to='/Svg2Png'>Svg2Png</Link>
        <Link to='/ImageToText'>ImageToText</Link>
        <Link to='/Pdf2Pptx'>PdfToPptx</Link>
        <Link to='/PdfCompressor'>PdfCompressor</Link>
        <Link to='/PdfEditor'>PdfEditor</Link>
        <Link to='/ExcelTableBuilder'>ExcelTableBuilder</Link>
        <Link to='/PdfToPptx'>PdfToPptx</Link>
        <Link to='/JpgToPdfPage'>JpgToPdfPage</Link>
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

export default App;
