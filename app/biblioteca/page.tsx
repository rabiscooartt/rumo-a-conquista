import BibliotecaClient from "@/app/biblioteca/BibliotecaClient";
import { loadLibraryInitialData } from "@/lib/homeInitialData";

export default async function BibliotecaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ catalog, journeyRows }, { filtro, filter }] = await Promise.all([
    loadLibraryInitialData(),
    searchParams,
  ]);
  const initialFilter = filtro ?? filter;

  return (
    <BibliotecaClient
      initialCatalog={catalog}
      initialJourneyRows={journeyRows}
      initialFilter={typeof initialFilter === "string" ? initialFilter : null}
    />
  );
}
