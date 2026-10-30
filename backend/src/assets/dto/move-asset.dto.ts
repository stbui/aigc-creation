import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString, MinLength } from 'class-validator';

/**
 * `PATCH /assets/move` —— 批量把素材移动到另一个项目 (分组)。
 *
 * 上限 100 与后台批量动作 (`runBatch`) 保持一致: 超过就该分多次,
 * 否则单请求事务/锁时间过长, 且前端选择态也无法一次承载。
 */
export class MoveAssetsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  ids: string[];

  @IsString()
  @MinLength(1)
  projectId: string;
}
