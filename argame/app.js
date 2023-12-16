document.addEventListener('DOMContentLoaded', () => {
    const video = document.getElementById('video');
    const box = document.getElementById('box');

    navigator.mediaDevices.getUserMedia({ video: true })
        .then((stream) => {
            video.srcObject = stream;
            const handpose = new Handpose({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs/${file}` });
            handpose.initialize().then(() => {
                handpose.update(video);
                setInterval(detectHands, 100);
            });
        });

    function detectHands() {
        handpose.estimateHands(video).then((hands) => {
            if (hands.length > 0) {
                const hand = hands[0].landmarks;

                const handX = hand[9][0];
                const handY = hand[9][1];

                const boxX = box.offsetLeft;
                const boxY = box.offsetTop;
                const boxWidth = box.offsetWidth;
                const boxHeight = box.offsetHeight;

                if (isInsideBox(handX, handY, boxX, boxY, boxWidth, boxHeight)) {
                    // 碰撞事件發生
                    handleCollision();
                }
            }
        });
    }

    function isInsideBox(x, y, boxX, boxY, boxWidth, boxHeight) {
        return x > boxX && x < boxX + boxWidth && y > boxY && y < boxY + boxHeight;
    }

    function handleCollision() {
        // 處理碰撞事件，例如增加點數
        console.log('碰撞事件發生！');
    }
});
