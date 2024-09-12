const fs = require("fs").promises;
const path = require("path");

async function mergeMdFiles(inputDir, outputDir, outputFileName) {
  try {
    // 确保输入路径是绝对路径
    inputDir = path.resolve(inputDir);
    outputDir = path.resolve(outputDir);

    // 读取目录内容
    const files = await fs.readdir(inputDir);

    // 过滤出.md文件并按文件名排序
    const mdFiles = files
      .filter((file) => path.extname(file).toLowerCase() === ".md")
      .sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
      );

    let mergedContent = "";

    // 遍历所有排序后的.md文件
    for (const file of mdFiles) {
      const filePath = path.join(inputDir, file);
      // 使用utf-8编码读取文件内容,避免中文乱码
      const content = await fs.readFile(filePath, "utf-8");
      // 直接添加文件内容,不添加文件名作为标题
      mergedContent += `\n\n${content}`;
    }

    // 确保输出目录存在
    await fs.mkdir(outputDir, { recursive: true });

    // 使用指定的输出文件名,如果没有提供则使用默认的"merged.md"
    const finalOutputFileName = outputFileName || "merged.md";

    // 写入合并后的内容到新文件
    const outputPath = path.join(outputDir, finalOutputFileName);
    await fs.writeFile(outputPath, mergedContent, "utf-8");
    console.log(`文件合并完成,已保存为 ${outputPath}`);
  } catch (error) {
    console.error("合并文件时出错:", error);
  }
}

// 获取命令行参数
const inputDir = process.argv[2];
const outputDir = process.argv[3];
const outputFileName = process.argv[4];

if (!inputDir || !outputDir) {
  console.log("请提供输入目录和输出目录的路径");
  console.log(
    "使用方法: node merge-md-files.js <输入目录路径> <输出目录路径> [输出文件名]"
  );
  console.log("注意: 输出文件名是可选的。如果不提供,将使用默认名称'merged.md'");
} else {
  mergeMdFiles(inputDir, outputDir, outputFileName);
}
