import { DescargaService } from './descarga.service';

describe('DescargaService.csv — blob → <a download> → limpieza', () => {
  it('baja el contenido exacto con nombre y MIME csv, y libera la URL de objeto', async () => {
    const servicio = new DescargaService();
    const blobs: Blob[] = [];
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      blobs.push(b as Blob);
      return 'blob:mock';
    });
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const descargas: { nombre: string; href: string }[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        descargas.push({ nombre: this.download, href: this.href });
      });

    servicio.csv('boletas-2026-09-10.csv', 'a;b');

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const blob = blobs[0];
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(await blob.text()).toBe('a;b');
    expect(descargas).toEqual([{ nombre: 'boletas-2026-09-10.csv', href: 'blob:mock' }]);
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock');

    createSpy.mockRestore();
    revokeSpy.mockRestore();
    clickSpy.mockRestore();
  });
});
