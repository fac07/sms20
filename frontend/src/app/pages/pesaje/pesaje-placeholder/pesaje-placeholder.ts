import { Component } from '@angular/core';
import { NzResultModule } from 'ng-zorro-antd/result';

// Placeholder de la ruta `pesaje` mientras el motor configurable (slice C) no
// esté. La navegación directa a la URL cae acá; el ítem de menú se removió.
@Component({
  imports: [NzResultModule],
  selector: 'app-pesaje-placeholder',
  template: `
    <nz-result
      nzStatus="info"
      nzTitle="Pesaje — motor configurable pendiente"
      nzSubTitle="La captura de secciones y campos configurables llega en la próxima iteración (slice C)."
    ></nz-result>
  `,
})
export class PesajePlaceholderPage {}
