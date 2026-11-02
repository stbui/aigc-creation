/** 未框选区域时的使用步骤卡。 */
export function ProductSkuStepsCard() {
  return (
    <section className="product-sku-card product-sku-steps-card">
      <h2>使用步骤</h2>
      <ol className="product-sku-steps">
        <li className="product-sku-step">
          <b>1</b>
          <div>
            <strong>上传模板图</strong>
            <span>导入 SKU 图，作为批量生成的模板图</span>
          </div>
        </li>
        <li className="product-sku-step">
          <b>2</b>
          <div>
            <strong>框选要变化的区域</strong>
            <span>框选可变内容区域，精准控制生成范围</span>
          </div>
        </li>
        <li className="product-sku-step">
          <b>3</b>
          <div>
            <strong>编辑SKU清单</strong>
            <span>录入商品 SKU 信息，配置每个 SKU 的变化内容</span>
          </div>
        </li>
        <li className="product-sku-step">
          <b>4</b>
          <div>
            <strong>批量输出SKU图</strong>
            <span>一键生成多款 SKU 图，高效完成批量出图</span>
          </div>
        </li>
      </ol>
    </section>
  );
}
