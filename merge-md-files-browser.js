let files = [];
let isFolder = false;
let folderName = "";
let abortController = null;

function handleFiles(newFiles, isFolder) {
  files = [];
  folderName = "";
  Array.from(newFiles).forEach((file) => {
    if (file.name.toLowerCase().endsWith(".md")) {
      files.push(file);
      // 检查是否是文件夹上传
      if (isFolder && file.webkitRelativePath) {
        folderName = file.webkitRelativePath.split("/")[0];
      }
    }
  });
  files.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
  updateFileList();
}

function updateFileList() {
  const fileList = document.getElementById("fileList");
  if (files.length > 0) {
    fileList.innerHTML = files
      .map((file) => `<div>${file.name}</div>`)
      .join("");
    fileList.style.display = "block"; // 显示文件列表
  } else {
    fileList.innerHTML = "";
    fileList.style.display = "none"; // 隐藏文件列表
  }
  document.getElementById("mergeButton").disabled = files.length === 0;
}

function showLoading() {
  document.getElementById("loadingOverlay").style.display = "flex";
  document
    .getElementById("abortButton")
    .addEventListener("click", abortOperation);
  abortController = new AbortController();
}

function hideLoading() {
  document.getElementById("loadingOverlay").style.display = "none";
  document
    .getElementById("abortButton")
    .removeEventListener("click", abortOperation);
  abortController = null;
}

function abortOperation() {
  if (abortController) {
    abortController.abort();
    hideLoading();
    showPopup("操作已终止");
  }
}

async function mergeFiles() {
  showLoading();
  try {
    const useFilenameAsTitle =
      document.getElementById("useFilenameAsTitle").checked;
    const cacheImages = document.getElementById("cacheImages").checked;

    // 1. 获取合并后的文件
    let mergedContent = await getMergedContent(useFilenameAsTitle);

    if (cacheImages) {
      console.log("缓存图片");
      // 2. 提取合并后文件中所有的图片链接地址
      const imageUrls = extractImageUrls(mergedContent);

      // 3. 下载所有图片
      const imageCache = await downloadImages(imageUrls);
      console.log("imageCache", imageCache);

      // 4. 替换合并后文件中的链接地址为本地地址
      mergedContent = replaceImageUrls(mergedContent, imageCache);

      // 5. 组织文件结构并打包为压缩包
      await createAndDownloadZip(mergedContent, imageCache);
    } else {
      // 如果不缓存图片，直接下载合并后的文件
      downloadMergedFile(mergedContent);
    }
  } catch (error) {
    if (error.name === "AbortError") {
      console.log("操作被用户终止");
    } else {
      console.error("合并文件时出错:", error);
      showPopup("合并文件时出错，请查看控制台以获取详细信息。");
    }
  } finally {
    hideLoading();
  }
}

async function getMergedContent(useFilenameAsTitle) {
  let mergedContent = "";
  for (const file of files) {
    let content = await file.text();
    if (useFilenameAsTitle) {
      const title = file.name.replace(/\.md$/, "");
      content = content.replace(/^#{1,6} /gm, (match) => "#" + match);
      mergedContent += `\n\n# ${title}\n\n${content}`;
    } else {
      mergedContent += `\n\n${content}`;
    }
  }
  return mergedContent.trim();
}

function extractImageUrls(content) {
  const imgRegex = /!\[.*?\]\((https?:\/\/[^\s)]+)\)/g;
  const urls = new Set();
  console.log("imgRegex.exec", imgRegex.exec(content));
  let match;
  while ((match = imgRegex.exec(content)) !== null) {
    if (match[1]) {
      urls.add(match[1]);
    }
  }
  console.log("匹配到的图片URL数量:", urls.size);
  console.log("urls", urls);
  return Array.from(urls);
}

async function downloadImages(imageUrls) {
  const imageCache = new Map();
  let failedCount = 0;
  for (const url of imageUrls) {
    if (abortController.signal.aborted) {
      throw new DOMException("AbortError", "AbortError");
    }
    try {
      const response = await fetch(url, { signal: abortController.signal });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const blob = await response.blob();
      const fileName = url.split("/").pop();
      const extension = getExtensionFromMimeType(blob.type);
      const fileNameWithExtension = ensureFileExtension(fileName, extension);
      imageCache.set(url, { blob, fileName: fileNameWithExtension });
    } catch (error) {
      if (error.name === "AbortError") {
        throw error;
      }
      console.error(`下载图片失败: ${url}`, error);
      failedCount++;
      showPopup(`图片下载失败: ${url}`);
    }
  }
  if (failedCount > 0) {
    showPopup(`共有 ${failedCount} 张图片下载失败`);
  }
  return imageCache;
}

function getExtensionFromMimeType(mimeType) {
  const mimeToExt = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
  };
  console.log("mimeToExt", mimeToExt[mimeType]);
  return mimeToExt[mimeType] || ".jpg";
}

function ensureFileExtension(fileName, extension) {
  if (fileName.toLowerCase().endsWith(extension.toLowerCase())) {
    return fileName;
  }
  return `${fileName}${extension}`;
}

function replaceImageUrls(content, imageCache) {
  const imgRegex = /!\[.*?\]\((https?:\/\/[^\s)]+)\)/g;
  console.log("替换链接");
  return content.replace(imgRegex, (match, url) => {
    console.log("url", url);
    if (imageCache.has(url)) {
      const fileName = imageCache
        .get(url)
        .fileName.replace(/[<>:"/\\|?*]+/g, "_");
      return match.replace(url, `imgs/${fileName}`);
    }
    return match;
  });
}

async function createAndDownloadZip(mergedContent, imageCache) {
  const zip = new JSZip();
  let outputFileName =
    document.getElementById("outputFileName").value.trim() || "merged.md";
  if (!outputFileName.toLowerCase().endsWith(".md")) {
    outputFileName += ".md";
  }
  const folderName = outputFileName.replace(/\.md$/, "");

  // 创建主文件夹
  const folder = zip.folder(folderName);

  // 添加合并后的 Markdown 文件到主文件夹，使用 outputFileName
  folder.file(outputFileName, mergedContent);

  // 创建 imgs 子文件夹
  const imgFolder = folder.folder("imgs");

  // 添加图片文件到 imgs 子文件夹
  for (const [url, { blob, fileName }] of imageCache) {
    console.log("imgFileName", fileName);
    imgFolder.file(fileName, blob);
  }

  // 生成并下载 ZIP 文件
  const content = await zip.generateAsync({ type: "blob" });
  downloadFile(content, `${folderName}.zip`);
}

function downloadMergedFile(content) {
  let outputFileName =
    document.getElementById("outputFileName").value.trim() || "merged.md";
  if (!outputFileName.toLowerCase().endsWith(".md")) {
    outputFileName += ".md";
  }
  const blob = new Blob([content], { type: "text/markdown" });
  downloadFile(blob, outputFileName);
}

function downloadFile(content, fileName) {
  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  setTimeout(() => {
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    hideLoading();
  }, 0);
}

// 设置拖放事件监听器
const dropArea = document.getElementById("dropArea");

["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
  dropArea.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

["dragenter", "dragover"].forEach((eventName) => {
  dropArea.addEventListener(eventName, highlight, false);
});

["dragleave", "drop"].forEach((eventName) => {
  dropArea.addEventListener(eventName, unhighlight, false);
});

function highlight() {
  dropArea.classList.add("highlight");
}

function unhighlight() {
  dropArea.classList.remove("highlight");
}

dropArea.addEventListener("drop", handleDrop, false);

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();

  folderName = "";

  if (e.dataTransfer.items) {
    // 使用 DataTransferItemList 接口处理拖放的项目
    for (let i = 0; i < e.dataTransfer.items.length; i++) {
      if (e.dataTransfer.items[i].kind === "file") {
        const entry = e.dataTransfer.items[i].webkitGetAsEntry();
        if (entry.isDirectory) {
          folderName = entry.name;
          traverseDirectory(entry);
        } else if (entry.isFile && entry.name.toLowerCase().endsWith(".md")) {
          entry.file((file) => {
            files.push(file);
            updateFileList();
          });
        }
      }
    }
  } else {
    // 使用 DataTransfer 接口处理拖放的文件
    handleFiles(e.dataTransfer.files, false);
  }
}

function traverseDirectory(dirEntry) {
  const reader = dirEntry.createReader();
  reader.readEntries((entries) => {
    entries.forEach((entry) => {
      if (entry.isDirectory) {
        traverseDirectory(entry);
      } else if (entry.isFile && entry.name.toLowerCase().endsWith(".md")) {
        entry.file((file) => {
          files.push(file);
          updateFileList();
        });
      }
    });
  });
}

// 修改文件输入事件监听器
document.getElementById("fileInput").addEventListener("change", function (e) {
  handleFiles(e.target.files, false);
});

document.getElementById("folderInput").addEventListener("change", function (e) {
  handleFiles(e.target.files, true);
});

// 删除原来的文件输入事件监听器

// 在文件末尾添加这个函数
function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("closed");
}

function showPopup(message) {
  const popup = document.createElement("div");
  popup.textContent = message;
  popup.style.position = "fixed";
  popup.style.top = "20px";
  popup.style.left = "50%";
  popup.style.transform = "translate(-50%, -50%) scale(0.5)";
  popup.style.backgroundColor = "rgba(255, 0, 0, 0.8)";
  popup.style.color = "white";
  popup.style.padding = "10px 20px";
  popup.style.borderRadius = "5px";
  popup.style.zIndex = "1002";
  popup.style.maxWidth = "80%";
  popup.style.textAlign = "center";
  popup.style.boxShadow = "0 4px 15px rgba(0, 0, 0, 0.2)";
  popup.style.transition = "all 0.3s ease-out";
  popup.style.opacity = "0";

  document.body.appendChild(popup);

  // 强制重绘
  popup.offsetHeight;

  // 开始动画
  popup.style.transform = "translate(-50%, 0) scale(1)";
  popup.style.opacity = "1";

  // 3秒后开始淡出
  setTimeout(() => {
    popup.style.opacity = "0";
    popup.style.transform = "translate(-50%, 0) scale(0.8)";
  }, 2700);

  // 3.3秒后移除元素
  setTimeout(() => {
    document.body.removeChild(popup);
  }, 3000);
}