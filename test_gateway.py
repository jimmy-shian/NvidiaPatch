# -*- coding: utf-8 -*-
import urllib.request
import urllib.error
import json
import time
import sys

# 強制 Windows 終端輸出為 UTF-8
sys.stdout.reconfigure(encoding='utf-8')

GATEWAY_URL = "http://localhost:4000/v1/chat/completions"
API_URL = "http://localhost:4000/api"

def print_section(title):
    print("=" * 60)
    print(f" 測試項目: {title}")
    print("=" * 60)

def test_api_connectivity():
    print_section("檢查 Gateway 管理 API 連線度")
    try:
        req = urllib.request.Request(f"{API_URL}/keys", method="GET")
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode('utf-8'))
            print(f"[成功] 成功獲取 API 金鑰池列表，當前金鑰數量: {len(data)}")
            return True
    except Exception as e:
        print(f"[失敗] 無法連接到 Gateway API，錯誤: {e}")
        print("請確保 Electron App 或背景 Gateway 服務已啟動並監聽在 Port 4000！")
        return False

def test_chat_completions_non_stream():
    print_section("測試 /v1/chat/completions 非串流 (Non-stream) 轉發")
    
    # 建立一個測試用的 API Key (模擬調用)
    # 我們假設目前金鑰池已有有效 Key。如果沒有，此測試將會顯示 Gateway 返回的 503。
    payload = {
        "model": "patcher-main",
        "messages": [
            {"role": "user", "content": "你好，請簡短回答哈囉並說明你是誰。"}
        ],
        "stream": False
    }
    
    try:
        data_bytes = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            GATEWAY_URL, 
            data=data_bytes, 
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        
        start_time = time.time()
        with urllib.request.urlopen(req, timeout=30) as response:
            res_body = response.read().decode('utf-8')
            res_json = json.loads(res_body)
            duration = time.time() - start_time
            
            print(f"[成功] 收到非串流響應 (耗時 {duration:.2f} 秒):")
            print("-" * 40)
            if "choices" in res_json:
                print(res_json["choices"][0]["message"]["content"])
            else:
                print(f"響應格式不包含 choices: {res_json}")
            print("-" * 40)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8')
        print(f"[提示] Gateway 返回 HTTP 狀態碼: {e.code}")
        print(f"錯誤響應內容: {err_body}")
    except Exception as e:
        print(f"[失敗] 發生非預期異常: {e}")

def test_chat_completions_stream():
    print_section("測試 /v1/chat/completions 串流 (Stream) SSE 轉發")
    
    payload = {
        "model": "patcher-main",
        "messages": [
            {"role": "user", "content": "你好，請用三個詞形容程式設計。"}
        ],
        "stream": True
    }
    
    try:
        data_bytes = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            GATEWAY_URL, 
            data=data_bytes, 
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        
        print("[成功] 連線已建立，開始接收 SSE 串流數據:")
        print("-" * 40)
        
        start_time = time.time()
        with urllib.request.urlopen(req, timeout=30) as response:
            # 讀取串流
            while True:
                line_bytes = response.readline()
                if not line_bytes:
                    break
                line = line_bytes.decode('utf-8').strip()
                if line.startswith("data:"):
                    data_str = line[5:].strip()
                    if data_str == "[DONE]":
                        print("\n[串流結束]")
                        break
                    try:
                        chunk = json.loads(data_str)
                        if "choices" in chunk and len(chunk["choices"]) > 0:
                            delta = chunk["choices"][0].get("delta", {})
                            content = delta.get("content", "")
                            sys.stdout.write(content)
                            sys.stdout.flush()
                    except json.JSONDecodeError:
                        pass
        print("-" * 40)
        print(f"串流測試完成，總耗時: {time.time() - start_time:.2f} 秒")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8')
        print(f"[提示] Gateway 返回 HTTP 狀態碼: {e.code}")
        print(f"錯誤響應內容: {err_body}")
    except Exception as e:
        print(f"[失敗] 發生非預期異常: {e}")

if __name__ == "__main__":
    print("NVIDIA NIM LLM Gateway 測試套件啟動...")
    if test_api_connectivity():
        test_chat_completions_non_stream()
        test_chat_completions_stream()
    print("測試執行結束。")
